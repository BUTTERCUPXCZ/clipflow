"""Peak GPU memory while a block runs (system-design §10.3), sampled with nvidia-smi."""

import shutil
import subprocess
import threading


def read_used_mib() -> int | None:
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=True,
        ).stdout
        return max(int(line) for line in out.split() if line.strip().isdigit())
    except (subprocess.SubprocessError, ValueError):
        return None


class VramSampler:
    """`with VramSampler() as vram: ...` then `vram.peak_mib` (None when no NVIDIA GPU is visible)."""

    def __init__(self, interval: float = 0.5, reader=read_used_mib) -> None:
        self._interval = interval
        self._reader = reader
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self.peak_mib: int | None = None

    def __enter__(self) -> "VramSampler":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join(timeout=5)
        self._sample()

    def _run(self) -> None:
        while not self._stop.is_set():
            self._sample()
            self._stop.wait(self._interval)

    def _sample(self) -> None:
        used = self._reader()
        if used is not None:
            self.peak_mib = used if self.peak_mib is None else max(self.peak_mib, used)
