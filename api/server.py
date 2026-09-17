"""
Minimal local dev server — the one exception to "the browser never calls
Bubble directly" (see bonds.py, natcat_loss.py): this process is the
server-side hop that rule requires. It holds RHODEX_API_KEY, calls Bubble,
and hands the admin UI back plain JSON. Nothing else lives here yet.

Dev-only. Not deployed anywhere; run it alongside the Vite dev server:

    python3 api/server.py

Endpoints:
  GET /bonds?type=natcat   -> list_bonds(type), extracted to a plain array.

CORS is wide open (Access-Control-Allow-Origin: *) because this never
runs anywhere but localhost during development — tighten this before any
real deployment, the same "replace before launch" caveat as
CANONICAL_TRIGGERS/RHODEX_COMPANY_WALLET in the UI.
"""

from flask import Flask, jsonify, request

import bonds

app = Flask(__name__)


@app.after_request
def _allow_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.get("/bonds")
def get_bonds():
    bond_type = request.args.get("type", "natcat")
    try:
        resp = bonds.list_bonds(bond_type)
    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(bonds.extract_bonds(resp))


if __name__ == "__main__":
    app.run(port=5001, debug=True)
