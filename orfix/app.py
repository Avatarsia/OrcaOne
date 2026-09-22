"""FastAPI app: JSON API under /api, the static UI under /."""

import json
import mimetypes
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, guard, instances, overview

STATIC_DIR = Path(__file__).parent / "static"
_LOCAL_HOSTS = {"127.0.0.1", "localhost"}

# On Windows the registry can map .js to text/plain, and browsers then refuse to
# run ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")


class Utf8Response(JSONResponse):
    """JSONResponse that does not fail on odd file names: on Linux a name that is not valid UTF-8
    (from a Latin-1 ZIP, say) reaches Python with surrogate escapes, which strict UTF-8 refuses.
    Those characters become "?"."""

    def render(self, content) -> bytes:
        text = json.dumps(content, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        return text.encode("utf-8", "replace")


app = FastAPI(title="Orfix", version=__version__, docs_url=None, redoc_url=None, openapi_url=None,
              default_response_class=Utf8Response)


def _hostname(value: str) -> str | None:
    return urlparse(f"//{value}").hostname


@app.middleware("http")
async def local_only(request: Request, call_next):
    # The server listens on 127.0.0.1 only. Checking Host blocks DNS rebinding,
    # checking Origin blocks other pages (even other local ports) from sending
    # changes, and refusing frames blocks clickjacking.
    host = request.headers.get("host", "")
    if _hostname(host) not in _LOCAL_HOSTS:
        return Utf8Response({"error": "forbidden"}, status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin != f"http://{host}":
        return Utf8Response({"error": "forbidden"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    # Revalidate every file: browsers otherwise keep old ES modules after an
    # update of Orfix and mix them with new ones.
    response.headers["Cache-Control"] = "no-cache"
    return response


def _error(code: str, status: int = 400) -> JSONResponse:
    return Utf8Response({"error": code}, status_code=status)


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


@app.get("/api/data")
def data():
    # Read fresh on every call: the slicer may have changed its files or started meanwhile.
    # A response directly: FastAPI's jsonable_encoder is slow for a megabyte of nested dicts.
    return Utf8Response(overview.build_all())


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
