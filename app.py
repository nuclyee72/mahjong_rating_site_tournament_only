from flask import Flask, Blueprint, request, jsonify, render_template, Response, redirect, url_for
from flask_cors import CORS
import sqlite3
from datetime import datetime
import os
import io
import csv
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_config():
    with open(os.path.join(BASE_DIR, "config.json"), "r", encoding="utf-8") as f:
        return json.load(f)

DB_PATH = os.path.join(BASE_DIR, "games.db")
CLUB_NAME = "<동아리명>"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    # 대회전 게임 기록
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tournament_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            player1_name TEXT NOT NULL,
            player2_name TEXT NOT NULL,
            player3_name TEXT NOT NULL,
            player4_name TEXT NOT NULL,
            player1_score INTEGER NOT NULL,
            player2_score INTEGER NOT NULL,
            player3_score INTEGER NOT NULL,
            player4_score INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config['JSON_AS_ASCII'] = False
app.config['TEMPLATES_AUTO_RELOAD'] = True

mahjong_bp = Blueprint('mahjong', __name__)

@app.context_processor
def inject_club_name():
    cfg = get_config()
    return dict(club_name=CLUB_NAME, config=cfg)

CORS(app)
init_db()

@mahjong_bp.route("/api/tournament_games", methods=["GET"])
def list_tournament_games():
    conn = get_db()
    cur = conn.execute("SELECT * FROM tournament_games ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])

@mahjong_bp.route("/api/tournament_games", methods=["POST"])
def create_tournament_game():
    data = request.get_json() or {}

    required = [
        "player1_name", "player2_name", "player3_name", "player4_name",
        "player1_score", "player2_score", "player3_score", "player4_score",
    ]
    if not all(k in data for k in required):
        return jsonify({"error": "missing fields"}), 400

    p1 = str(data["player1_name"]).strip()
    p2 = str(data["player2_name"]).strip()
    p3 = str(data["player3_name"]).strip()
    p4 = str(data["player4_name"]).strip()
    if not (p1 and p2 and p3 and p4):
        return jsonify({"error": "all player names required"}), 400

    try:
        s1 = int(data["player1_score"])
        s2 = int(data["player2_score"])
        s3 = int(data["player3_score"])
        s4 = int(data["player4_score"])
    except (ValueError, TypeError):
        return jsonify({"error": "scores must be integers"}), 400

    cfg = get_config()["MAHJONG_CONFIG"]
    target_sum = cfg["START_SCORE"] * 4
    if (s1 + s2 + s3 + s4) != target_sum:
        return jsonify({"error": f"total score must be {target_sum}"}), 400

    created_at = datetime.now().isoformat(timespec="minutes")

    conn = get_db()
    cur = conn.execute("""
        INSERT INTO tournament_games (
            created_at,
            player1_name, player2_name, player3_name, player4_name,
            player1_score, player2_score, player3_score, player4_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (created_at, p1, p2, p3, p4, s1, s2, s3, s4))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return jsonify({"id": new_id}), 201

@mahjong_bp.route("/api/tournament_games/<int:game_id>", methods=["DELETE"])
def delete_tournament_game(game_id):
    conn = get_db()
    cur = conn.execute("DELETE FROM tournament_games WHERE id = ?", (game_id,))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if deleted == 0:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

@mahjong_bp.route("/export_tournament", methods=["GET"])
def export_tournament_games():
    conn = get_db()
    cur = conn.execute("""
        SELECT
            id, created_at,
            player1_name, player2_name, player3_name, player4_name,
            player1_score, player2_score, player3_score, player4_score
        FROM tournament_games
        ORDER BY id ASC
    """)
    rows = cur.fetchall()
    conn.close()

    def calc_pts(scores):
        cfg = get_config()["MAHJONG_CONFIG"]
        ret = cfg["RETURN_SCORE"]
        uma_vals = cfg["UMA"]
        oka = cfg["OKA_TO_1ST"]

        order = sorted(range(4), key=lambda i: scores[i], reverse=True)

        uma_for_player = [0, 0, 0, 0]
        for rank, idx in enumerate(order):
            uma_for_player[idx] = uma_vals[rank] + (oka if rank == 0 else 0)

        pts = []
        for i in range(4):
            base = (scores[i] - ret) / 1000.0
            pts.append(base + uma_for_player[i])
        return pts

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "ID", "시간",
        "P1 이름", "P1 점수", "P1 pt",
        "P2 이름", "P2 점수", "P2 pt",
        "P3 이름", "P3 점수", "P3 pt",
        "P4 이름", "P4 점수", "P4 pt",
    ])

    for row in rows:
        scores = [
            row["player1_score"],
            row["player2_score"],
            row["player3_score"],
            row["player4_score"],
        ]
        pts = calc_pts(scores)

        writer.writerow([
            row["id"],
            row["created_at"],
            row["player1_name"], scores[0], f"{pts[0]:.1f}",
            row["player2_name"], scores[1], f"{pts[1]:.1f}",
            row["player3_name"], scores[2], f"{pts[2]:.1f}",
            row["player4_name"], scores[3], f"{pts[3]:.1f}",
        ])

    csv_data = output.getvalue()
    output.close()
    csv_bytes = csv_data.encode("cp949", errors="replace")

    return Response(
        csv_bytes,
        mimetype="text/csv; charset=cp949",
        headers={"Content-Disposition": "attachment; filename=mahjong_tournament.csv"},
    )

@mahjong_bp.route("/import_tournament", methods=["GET", "POST"])
def import_tournament_games():
    if request.method == "GET":
        return f"""
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>{CLUB_NAME} 대회전 CSV 업로드</title>
          <link rel="stylesheet" href="/static/style.css">
        </head>
        <body>
          <div class="top-bar">
            <h1>{CLUB_NAME} 대회전 CSV 업로드</h1>
            <div class="view-switch">
              <a href="/" class="view-switch-btn">메인으로 돌아가기</a>
            </div>
          </div>
          <div class="main-layout">
            <div class="left-panel">
              <section class="games-panel">
                <h2>대회전 CSV 업로드</h2>
                <p class="hint-text">
                  * /export_tournament 에서 받은 CSV나<br>
                  * ID / 시간 / P1 이름 / P1 점수 / ... 형식의 파일 모두 인식합니다.
                </p>
                <form method="post" enctype="multipart/form-data">
                  <p><input type="file" name="file" accept=".csv" required></p>
                  <p><button type="submit">업로드</button></p>
                </form>
              </section>
            </div>
          </div>
        </body>
        </html>
        """

    file = request.files.get("file")
    if not file:
        return "파일이 없습니다.", 400

    raw = file.read()
    text = None
    for enc in ("utf-8-sig", "utf-8", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        return "알 수 없는 인코딩입니다. UTF-8 또는 CP949로 저장해주세요.", 400

    import io as _io
    sample = "\\n".join(text.splitlines()[:5])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    except Exception:
        dialect = csv.excel
        dialect.delimiter = ","

    reader = csv.DictReader(_io.StringIO(text), dialect=dialect)

    def pick(row, keys, default=""):
        for k in keys:
            if k in row and row[k] not in (None, ""):
                return row[k]
        return default

    def pick_int(row, keys, default=0):
        val = pick(row, keys, None)
        if val is None or val == "":
            return default
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return default

    conn = get_db()
    inserted = 0

    for row in reader:
        created_at = pick(row, ["created_at", "시간"])
        if not created_at:
            created_at = datetime.now().isoformat(timespec="minutes")

        p1_name = pick(row, ["player1_name", "P1 이름", "P1이름"])
        p2_name = pick(row, ["player2_name", "P2 이름", "P2이름"])
        p3_name = pick(row, ["player3_name", "P3 이름", "P3이름"])
        p4_name = pick(row, ["player4_name", "P4 이름", "P4이름"])

        s1 = pick_int(row, ["player1_score", "P1 점수", "P1점수"])
        s2 = pick_int(row, ["player2_score", "P2 점수", "P2점수"])
        s3 = pick_int(row, ["player3_score", "P3 점수", "P3점수"])
        s4 = pick_int(row, ["player4_score", "P4 점수", "P4점수"])

        if not (p1_name or p2_name or p3_name or p4_name):
            continue

        conn.execute("""
            INSERT INTO tournament_games (
                created_at,
                player1_name, player2_name, player3_name, player4_name,
                player1_score, player2_score, player3_score, player4_score
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (created_at, p1_name, p2_name, p3_name, p4_name, s1, s2, s3, s4))
        inserted += 1

    conn.commit()
    conn.close()

    print(f"[IMPORT_TOURNAMENT] inserted rows: {inserted}")
    return redirect(url_for("mahjong.index_page"))

@mahjong_bp.route("/manifest.json")
def manifest():
    data = {
        "name": CLUB_NAME,
        "short_name": CLUB_NAME,
        "start_url": "/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#4f7dff",
        "icons": [
            {
                "src": "/static/icon.png",
                "sizes": "192x192",
                "type": "image/png"
            }
        ]
    }
    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        mimetype="application/manifest+json"
    )

@mahjong_bp.route("/")
def index_page():
    return render_template("index.html", club_name=CLUB_NAME)

app.register_blueprint(mahjong_bp, url_prefix="/")

if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
