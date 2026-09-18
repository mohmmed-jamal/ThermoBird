"""
Authentication service removed.

This file used to provide password hashing, JWT creation/validation and user
lookup helpers. In the public/anonymous deployment mode these functions are
not used. Keep a lightweight stub here to avoid import errors in libraries or
scripts that might still reference the module; calling any function will
raise a clear RuntimeError explaining the removal.
"""

def _removed(*args, **kwargs):
    raise RuntimeError("Authentication service has been removed in anonymous/public mode.")


def hash_password(*args, **kwargs):
    return _removed()


def verify_password(*args, **kwargs):
    return _removed()


def create_access_token(*args, **kwargs):
    return _removed()


def create_refresh_token(*args, **kwargs):
    return _removed()


def decode_token(*args, **kwargs):
    return _removed()


def get_user_by_email(*args, **kwargs):
    return _removed()


def get_user_by_id(*args, **kwargs):
    return _removed()


def create_user(*args, **kwargs):
    return _removed()


def get_user_tier_data(*args, **kwargs):
    return _removed()


def authenticate_user(*args, **kwargs):
    return _removed()
