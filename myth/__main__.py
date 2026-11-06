import os

import uvicorn

from .app import create_app


if __name__ == "__main__":
    uvicorn.run(create_app(), host=os.environ.get("MYTH_HOST", "127.0.0.1"), port=int(os.environ.get("MYTH_PORT", "8000")))
