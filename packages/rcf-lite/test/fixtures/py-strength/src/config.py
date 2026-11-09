"""Settings for the test-strength fixture: one class with a constructor,
plain methods, a decorated method and an async method."""

import asyncio
import json


class Config:
    """Key and value settings."""

    def __init__(self, values):
        self.values = dict(values)

    def lookup(self, key):
        """The value of key; a KeyError naming key when it is not set."""
        if key not in self.values:
            raise KeyError(key)
        return self.values[key]

    def merge(self, values):
        """Set every key of values over the current ones."""
        self.values.update(values)

    @classmethod
    def from_text(cls, text):
        """A Config read from the text of a JSON object."""
        config = cls({})
        config.merge(json.loads(text))
        return config

    async def fetch(self, key):
        """The value of key, after yielding once to the event loop."""
        await asyncio.sleep(0)
        return self.lookup(key)
