"""FastAPI app: JSON API under /api, the static UI under /."""

import mimetypes
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, guard, instances

STATIC_DIR = Path(__file__).parent / "static"
_LOCAL_HOSTS = {"127.0.0.1", "localhost"}

# On Windows the registry can map .js to text/plain, and browsers then refuse to
# run ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

app = FastAPI(title="Orfix", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)


def _hostname(value: str) -> str | None:
    return urlparse(f"//{value}").hostname


@app.middleware("http")
async def local_only(request: Request, call_next):
    # The server listens on 127.0.0.1 only. Checking Host blocks DNS rebinding,
    # checking Origin blocks other pages (even other local ports) from sending
    # changes, and refusing frames blocks clickjacking.
    host = request.headers.get("host", "")
    if _hostname(host) not in _LOCAL_HOSTS:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin != f"http://{host}":
        return JSONResponse({"error": "forbidden"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    return response


def _error(code: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status)


@app.get("/api/instances")
def list_instances():
    processes = guard.find_processes()
    process_dirs = [p.data_dir for p in processes if p.data_dir]
    found = instances.discover(process_dirs)
    manual = set(instances.manual_paths())
    return {
        "version": __version__,
        "orfix_data_dir": str(instances.orfix_data_dir()),
        "instances": [
            {
                **asdict(instance),
                "manual": str(instance.data_dir) in manual,
                "run_state": asdict(guard.run_state(instance, processes)),
            }
            for instance in found
        ],
    }


@app.post("/api/instances/manual")
def add_manual(payload: dict = Body(...)):
    path = payload.get("path")
    if not isinstance(path, str):
        return _error("path_not_found")
    try:
        instance = instances.add_manual_path(path)
    except ValueError as exc:
        return _error(str(exc))
    except OSError:
        return _error("save_failed", 500)
    return {"instance": asdict(instance)}


@app.delete("/api/instances/manual")
def remove_manual(path: str):
    try:
        instances.remove_manual_path(path)
    except ValueError as exc:
        return _error(str(exc), 404)
    except OSError:
        return _error("save_failed", 500)
    return {"removed": path}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
