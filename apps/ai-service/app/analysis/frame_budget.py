from collections.abc import Sequence
from typing import TypeVar

T = TypeVar("T")


def select_evenly(items: Sequence[T], budget: int) -> list[T]:
    """Up to `budget` items spread evenly over the whole sequence, first and last included.
    Short videos (≤ budget frames) keep every frame."""
    if budget <= 0:
        raise ValueError("budget must be positive")
    if len(items) <= budget:
        return list(items)
    if budget == 1:
        return [items[0]]
    step = (len(items) - 1) / (budget - 1)
    return [items[round(i * step)] for i in range(budget)]


def batches(items: Sequence[T], size: int) -> list[list[T]]:
    if size <= 0:
        raise ValueError("batch size must be positive")
    return [list(items[i : i + size]) for i in range(0, len(items), size)]
