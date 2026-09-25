"""Entry point: `python -m statly_engine` runs the JSON-RPC sidecar server."""

import sys

from statly_engine.rpc import serve


def main() -> int:
    return serve()


if __name__ == "__main__":
    sys.exit(main())
