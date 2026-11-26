"""Generate Python gRPC stubs from the monorepo's shared proto/ directory.

Run from apps/ai-service:  uv run python scripts/gen_proto.py
"""

import sys
from pathlib import Path

from grpc_tools import protoc

SERVICE_ROOT = Path(__file__).resolve().parents[1]
PROTO_ROOT = SERVICE_ROOT.parents[1] / "proto"


def main() -> int:
    protos = sorted(str(p) for p in PROTO_ROOT.rglob("*.proto"))
    # Map proto/ to the virtual path app/generated so generated imports read
    # `from app.generated.ai.v1 import ...` instead of a bare top-level `ai` package.
    args = [
        "protoc",
        f"-Iapp/generated={PROTO_ROOT}",
        f"-I{protoc_include()}",
        f"--python_out={SERVICE_ROOT}",
        f"--pyi_out={SERVICE_ROOT}",
        f"--grpc_python_out={SERVICE_ROOT}",
        *protos,
    ]
    code = protoc.main(args)
    if code == 0:
        print(f"generated stubs for {len(protos)} proto file(s) into app/generated/")
    return code


def protoc_include() -> str:
    import grpc_tools

    return str(Path(grpc_tools.__file__).parent / "_proto")


if __name__ == "__main__":
    sys.exit(main())
