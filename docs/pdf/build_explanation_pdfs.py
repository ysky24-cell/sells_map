from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "pdf"
REPORT_DATE = "2026年6月13日"
APP_URL = "https://ysky24-cell.github.io/sells_map/"

FONT_REGULAR = "NotoSansJP"
FONT_BOLD = "BizUDGothicBold"

ACCENT_BLUE = colors.HexColor("#2563EB")
ACCENT_GREEN = colors.HexColor("#16A34A")
ACCENT_AMBER = colors.HexColor("#D97706")
ACCENT_RED = colors.HexColor("#DC2626")
INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#CBD5E1")
PALE_BLUE = colors.HexColor("#EFF6FF")
PALE_GREEN = colors.HexColor("#ECFDF5")
PALE_AMBER = colors.HexColor("#FFFBEB")
PALE_RED = colors.HexColor("#FEF2F2")
PALE_SLATE = colors.HexColor("#F8FAFC")


@dataclass(frozen=True)
class AppStats:
    locations: int
    visit_records: int
    visit_plans: int
    visit_plan_items: int
    decision_logs: int
    status_counts: dict[str, int]


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_REGULAR, "C:/Windows/Fonts/NotoSansJP-VF.ttf"))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, "C:/Windows/Fonts/BIZ-UDGothicB.ttc"))


def load_json(path: str) -> list[dict]:
    with (ROOT / path).open("r", encoding="utf-8") as f:
        return json.load(f)


def load_stats() -> AppStats:
    locations = load_json("data/locations.json")
    visit_records = load_json("data/visit-records.json")
    visit_plans = load_json("data/visit-plans.json")
    visit_plan_items = load_json("data/visit-plan-items.json")
    decision_logs = load_json("data/decision-logs.json")
    status_counts: dict[str, int] = {}
    for loc in locations:
        status = loc.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    return AppStats(
        locations=len(locations),
        visit_records=len(visit_records),
        visit_plans=len(visit_plans),
        visit_plan_items=len(visit_plan_items),
        decision_logs=len(decision_logs),
        status_counts=status_counts,
    )


def styles(accent: colors.Color) -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "title",
            fontName=FONT_BOLD,
            fontSize=24,
            leading=32,
            textColor=INK,
            alignment=TA_LEFT,
            wordWrap="CJK",
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            fontName=FONT_REGULAR,
            fontSize=11,
            leading=18,
            textColor=MUTED,
            wordWrap="CJK",
            spaceAfter=18,
        ),
        "h1": ParagraphStyle(
            "h1",
            fontName=FONT_BOLD,
            fontSize=16,
            leading=22,
            textColor=accent,
            wordWrap="CJK",
            spaceBefore=4,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName=FONT_BOLD,
            fontSize=12,
            leading=17,
            textColor=INK,
            wordWrap="CJK",
            spaceBefore=6,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            fontName=FONT_REGULAR,
            fontSize=9.2,
            leading=15,
            textColor=INK,
            wordWrap="CJK",
            spaceAfter=5,
        ),
        "small": ParagraphStyle(
            "small",
            fontName=FONT_REGULAR,
            fontSize=7.8,
            leading=12,
            textColor=MUTED,
            wordWrap="CJK",
            spaceAfter=3,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            fontName=FONT_REGULAR,
            fontSize=9,
            leading=14,
            textColor=INK,
            leftIndent=11,
            firstLineIndent=-11,
            wordWrap="CJK",
            spaceAfter=4,
        ),
        "table_head": ParagraphStyle(
            "table_head",
            fontName=FONT_BOLD,
            fontSize=8.4,
            leading=12,
            textColor=colors.white,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "table_cell": ParagraphStyle(
            "table_cell",
            fontName=FONT_REGULAR,
            fontSize=8.1,
            leading=12,
            textColor=INK,
            wordWrap="CJK",
        ),
        "table_cell_center": ParagraphStyle(
            "table_cell_center",
            fontName=FONT_REGULAR,
            fontSize=8.1,
            leading=12,
            textColor=INK,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "kpi_num": ParagraphStyle(
            "kpi_num",
            fontName=FONT_BOLD,
            fontSize=15,
            leading=19,
            textColor=accent,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "kpi_label": ParagraphStyle(
            "kpi_label",
            fontName=FONT_REGULAR,
            fontSize=7.6,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "callout": ParagraphStyle(
            "callout",
            fontName=FONT_REGULAR,
            fontSize=8.8,
            leading=14,
            textColor=INK,
            wordWrap="CJK",
        ),
        "cover_label": ParagraphStyle(
            "cover_label",
            fontName=FONT_BOLD,
            fontSize=9,
            leading=12,
            textColor=colors.white,
            alignment=TA_CENTER,
        ),
    }


def p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text.replace("\n", "<br/>"), style)


def bullets(items: Iterable[str], style: ParagraphStyle) -> list[Paragraph]:
    return [p(f"・{item}", style) for item in items]


def section_title(text: str, ss: dict[str, ParagraphStyle]) -> list:
    return [Spacer(1, 3 * mm), p(text, ss["h1"])]


def callout(text: str, ss: dict[str, ParagraphStyle], fill=PALE_BLUE, border=ACCENT_BLUE) -> Table:
    t = Table([[p(text, ss["callout"])]], colWidths=[170 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.8, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return t


def kpi_grid(items: list[tuple[str, str]], ss: dict[str, ParagraphStyle], accent: colors.Color) -> Table:
    rows = []
    for i in range(0, len(items), 2):
        row = []
        for value, label in items[i : i + 2]:
            row.append([p(value, ss["kpi_num"]), p(label, ss["kpi_label"])])
        while len(row) < 2:
            row.append("")
        rows.append(row)
    t = Table(rows, colWidths=[83 * mm, 83 * mm], rowHeights=[25 * mm] * len(rows))
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE_SLATE),
                ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return t


def data_table(
    headers: list[str],
    rows: list[list[str]],
    widths: list[float],
    ss: dict[str, ParagraphStyle],
    accent: colors.Color,
) -> Table:
    table_data = [[p(h, ss["table_head"]) for h in headers]]
    for row in rows:
        table_data.append([p(cell, ss["table_cell"]) for cell in row])
    t = Table(table_data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), accent),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E8F0")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE_SLATE]),
            ]
        )
    )
    return t


class RangeBarChart(Flowable):
    def __init__(self, title: str, rows: list[tuple[str, float, float, colors.Color]], max_value: float, unit: str):
        super().__init__()
        self.title = title
        self.rows = rows
        self.max_value = max_value
        self.unit = unit
        self.width = 170 * mm
        self.height = (22 + len(rows) * 20) * mm / 3

    def wrap(self, avail_width, avail_height):
        self.width = min(avail_width, 170 * mm)
        self.height = 20 + len(self.rows) * 28
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(INK)
        c.drawString(0, self.height - 12, self.title)
        label_w = 45 * mm
        bar_x = label_w
        bar_w = self.width - label_w - 12 * mm
        top = self.height - 30
        for i, (label, low, high, color) in enumerate(self.rows):
            y = top - i * 25
            c.setFont(FONT_REGULAR, 7.8)
            c.setFillColor(INK)
            c.drawString(0, y + 2, label)
            c.setFillColor(colors.HexColor("#E5E7EB"))
            c.roundRect(bar_x, y, bar_w, 9, 4, stroke=0, fill=1)
            x1 = bar_x + bar_w * low / self.max_value
            x2 = bar_x + bar_w * high / self.max_value
            c.setFillColor(color)
            c.roundRect(x1, y, max(2, x2 - x1), 9, 4, stroke=0, fill=1)
            c.setFont(FONT_BOLD, 7.4)
            c.setFillColor(INK)
            c.drawRightString(self.width, y + 1, f"{low:g}〜{high:g}{self.unit}")
        c.setStrokeColor(LINE)
        c.line(bar_x, top - len(self.rows) * 25 + 15, bar_x + bar_w, top - len(self.rows) * 25 + 15)
        c.setFont(FONT_REGULAR, 6.8)
        c.setFillColor(MUTED)
        for tick in [0, self.max_value / 2, self.max_value]:
            x = bar_x + bar_w * tick / self.max_value
            c.drawCentredString(x, top - len(self.rows) * 25 + 4, f"{tick:g}")
        c.restoreState()


class HorizontalBarChart(Flowable):
    def __init__(self, title: str, rows: list[tuple[str, float, colors.Color]], max_value: float, suffix: str):
        super().__init__()
        self.title = title
        self.rows = rows
        self.max_value = max_value
        self.suffix = suffix
        self.width = 170 * mm
        self.height = 110

    def wrap(self, avail_width, avail_height):
        self.width = min(avail_width, 170 * mm)
        self.height = 24 + len(self.rows) * 22
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(INK)
        c.drawString(0, self.height - 12, self.title)
        label_w = 58 * mm
        bar_x = label_w
        bar_w = self.width - label_w - 20 * mm
        top = self.height - 31
        for i, (label, value, color) in enumerate(self.rows):
            y = top - i * 22
            c.setFont(FONT_REGULAR, 7.6)
            c.setFillColor(INK)
            c.drawString(0, y + 1, label)
            c.setFillColor(colors.HexColor("#E5E7EB"))
            c.roundRect(bar_x, y, bar_w, 8, 4, stroke=0, fill=1)
            c.setFillColor(color)
            c.roundRect(bar_x, y, max(2, bar_w * value / self.max_value), 8, 4, stroke=0, fill=1)
            c.setFont(FONT_BOLD, 7.2)
            c.setFillColor(INK)
            c.drawRightString(self.width, y, f"{value:g}{self.suffix}")
        c.restoreState()


class StepFlow(Flowable):
    def __init__(self, steps: list[str], accent: colors.Color):
        super().__init__()
        self.steps = steps
        self.accent = accent
        self.width = 170 * mm
        self.height = 84

    def wrap(self, avail_width, avail_height):
        self.width = min(avail_width, 170 * mm)
        self.height = 86
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        box_w = (self.width - 20) / len(self.steps)
        y = 22
        for i, label in enumerate(self.steps):
            x = i * box_w + i * 4
            c.setFillColor(PALE_GREEN if self.accent == ACCENT_GREEN else PALE_BLUE)
            c.setStrokeColor(self.accent)
            c.roundRect(x, y, box_w, 44, 7, stroke=1, fill=1)
            c.setFillColor(self.accent)
            c.circle(x + 12, y + 32, 8, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont(FONT_BOLD, 8)
            c.drawCentredString(x + 12, y + 29, str(i + 1))
            c.setFillColor(INK)
            c.setFont(FONT_BOLD, 7.4)
            parts = label.split("/")
            for line_i, part in enumerate(parts[:3]):
                c.drawCentredString(x + box_w / 2, y + 23 - line_i * 10, part)
            if i < len(self.steps) - 1:
                c.setStrokeColor(MUTED)
                c.line(x + box_w + 1, y + 22, x + box_w + 8, y + 22)
                c.line(x + box_w + 8, y + 22, x + box_w + 5, y + 25)
                c.line(x + box_w + 8, y + 22, x + box_w + 5, y + 19)
        c.restoreState()


class StatusDots(Flowable):
    def __init__(self, rows: list[tuple[str, str, str]]):
        super().__init__()
        self.rows = rows
        self.width = 170 * mm
        self.height = 120

    def wrap(self, avail_width, avail_height):
        self.width = min(avail_width, 170 * mm)
        self.height = 26 + ((len(self.rows) + 2) // 3) * 26
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        col_w = self.width / 3
        for i, (label, desc, color) in enumerate(self.rows):
            col = i % 3
            row = i // 3
            x = col * col_w
            y = self.height - 30 - row * 26
            c.setFillColor(colors.HexColor(color))
            c.circle(x + 6, y + 7, 5, stroke=0, fill=1)
            c.setFillColor(INK)
            c.setFont(FONT_BOLD, 7.4)
            c.drawString(x + 15, y + 9, label)
            c.setFillColor(MUTED)
            c.setFont(FONT_REGULAR, 6.7)
            c.drawString(x + 15, y, desc)
        c.restoreState()


def doc_template(path: Path, title: str, accent: colors.Color) -> SimpleDocTemplate:
    return SimpleDocTemplate(
        str(path),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=17 * mm,
        bottomMargin=16 * mm,
        title=title,
        author="Codex",
    )


def on_page(title: str, accent: colors.Color):
    def draw(canvas, doc):
        width, height = A4
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#E2E8F0"))
        canvas.line(doc.leftMargin, 13 * mm, width - doc.rightMargin, 13 * mm)
        canvas.setFont(FONT_REGULAR, 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin, 8.5 * mm, "営業用地図アプリ MVP")
        canvas.drawCentredString(width / 2, 8.5 * mm, title)
        canvas.setFont(FONT_BOLD, 7.2)
        canvas.setFillColor(accent)
        canvas.drawRightString(width - doc.rightMargin, 8.5 * mm, f"{doc.page}")
        canvas.restoreState()

    return draw


def cover(title: str, subtitle: str, label: str, ss: dict[str, ParagraphStyle], accent: colors.Color) -> list:
    band = Table([[p(label, ss["cover_label"])]], colWidths=[45 * mm], rowHeights=[9 * mm])
    band.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), accent),
                ("BOX", (0, 0), (-1, -1), 0, accent),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return [
        Spacer(1, 18 * mm),
        band,
        Spacer(1, 10 * mm),
        p(title, ss["title"]),
        p(subtitle, ss["subtitle"]),
        Spacer(1, 18 * mm),
        callout(
            "紙地図で分断されていた訪問情報を、地図・訪問予定・履歴・重複警告・管理ダッシュボードとして共有するためのMVP説明資料です。",
            ss,
            fill=PALE_BLUE if accent == ACCENT_BLUE else PALE_GREEN,
            border=accent,
        ),
        Spacer(1, 48 * mm),
        p(f"作成日: {REPORT_DATE}<br/>公開URL: {APP_URL}", ss["small"]),
        PageBreak(),
    ]


def build_management_pdf(stats: AppStats) -> Path:
    out = OUT_DIR / "management-brief.pdf"
    ss = styles(ACCENT_BLUE)
    story = []
    story += cover(
        "経営層向け説明資料",
        "営業用地図アプリ MVP / 投資判断・業務効果・次フェーズ方針",
        "Management Brief",
        ss,
        ACCENT_BLUE,
    )

    story += section_title("1. 結論", ss)
    story.append(
        callout(
            "MVPは、紙地図運用をデジタル地図・訪問予定・履歴・重複警告へ置き換える第一段階として成立しています。"
            "現時点ではGitHub Pages上の静的プロトタイプですが、Repository層・MapProvider・GeocodingService・RouteServiceを分離しており、"
            "AWS・実地図APIへの移行前提で検証できます。加えて、未決定理由をナレッジ化し、対策案の優先度づけと営業周知まで扱えるようになりました。",
            ss,
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(
        kpi_grid(
            [
                ("90〜225時間/月", "紙地図確認・転記・徒歩移動などの削減余地"),
                ("33.75万〜84.375万円/月", "人件費換算の改善効果"),
                ("126〜315件/月", "削減時間の70%を訪問に回した場合の追加訪問枠"),
                ("0.5〜3か月", "初期備品投資の回収目安"),
            ],
            ss,
            ACCENT_BLUE,
        )
    )
    story += bullets(
        [
            "営業担当者9人、1人あたり紙地図100枚超を扱う前提で、共有・検索・予定化・履歴化の負担が大きい。",
            "導入後は住所検索、地図ピン、重複警告、訪問予定、ルート最適化により確認作業を短縮できる見込み。",
            "住宅地図APIや商用地図APIは契約条件により費用差が大きいため、次フェーズで要見積り。",
            "本番化ではCognito、DynamoDB、S3、Amazon Location Service等へ接続し、個人情報管理を強化する。",
        ],
        ss["bullet"],
    )

    story += section_title("2. 現行課題とMVPの対応", ss)
    story.append(
        data_table(
            ["現行の困りごと", "MVPでの対応", "経営上の意味"],
            [
                ["紙地図を探す、めくる、転記する作業が重い", "地点検索、ステータス別ピン、CSV入出力", "事務負担と属人管理を減らす"],
                ["訪問NG・施工済み・点検予定の見落とし", "重複候補、訪問NG、点検予定の警告", "クレーム・無駄訪問を抑える"],
                ["訪問予定が多い日に1件ずつ確認が必要", "地図上で複数ピン選択、180件規模を想定", "計画作成の処理量を上げる"],
                ["徒歩1万歩超になるケースがある", "ルート最適化、全画面地図、モバイル運用", "身体的負担を下げ、訪問時間へ再配分"],
                ["管理者が全体状況を把握しにくい", "KPI、未決定理由、システム管理へヘッダーから移動", "朝一番に見るべき集計へすぐアクセスできる"],
                ["決まらない理由が個人メモに残りがち", "未決定理由、リスク、対策案、採用/未採用理由をログ化", "現場の迷いを改善ノウハウとして蓄積できる"],
            ],
            [45, 58, 55],
            ss,
            ACCENT_BLUE,
        )
    )

    story += section_title("3. 効果試算", ss)
    story.append(
        RangeBarChart(
            "月間作業時間の仮置き比較",
            [
                ("現行の非効率", 144, 270, ACCENT_RED),
                ("導入後の残作業", 27, 54, ACCENT_AMBER),
                ("削減余地", 90, 225, ACCENT_GREEN),
            ],
            300,
            "h",
        )
    )
    story.append(Spacer(1, 3 * mm))
    story += bullets(
        [
            "1人月160時間、1人月60万円、1時間3,750円として仮置き。",
            "現行非効率は1人あたり月16〜30時間、9人で月144〜270時間と仮定。",
            "導入後は1人あたり月3〜6時間まで削減できると仮定し、改善効果は月90〜225時間。",
            "削減時間の70%を訪問予定時間へ回すと、月63〜157.5時間、30分/件換算で月126〜315件分の訪問枠に相当。",
        ],
        ss["bullet"],
    )

    story += section_title("4. 費用仮置き", ss)
    story.append(
        data_table(
            ["項目", "月額仮置き", "補足"],
            [
                ["AWS等サーバーレス構成", "1万〜6万円", "住宅地図APIを除く。利用量により変動"],
                ["住宅地図・商用地図API", "要見積り", "ZENRIN等。住宅地図精度が必要な場合は別途法人契約"],
                ["備品月額", "0.9万〜2.7万円", "折り畳み自転車の保守・消耗費等"],
                ["初期備品", "36.9万〜99.9万円", "9人分。ホルダー、折り畳み自転車、バッテリー、ケース"],
            ],
            [52, 37, 76],
            ss,
            ACCENT_BLUE,
        )
    )
    story.append(Spacer(1, 4 * mm))
    story.append(
        HorizontalBarChart(
            "月額クラウド・地図費用の最大仮置き内訳（住宅地図API除く）",
            [
                ("Amazon Location Service", 30000, ACCENT_BLUE),
                ("API Gateway + Lambda", 8000, colors.HexColor("#38BDF8")),
                ("Amplify/S3+CloudFront", 5000, colors.HexColor("#60A5FA")),
                ("DynamoDB", 5000, colors.HexColor("#93C5FD")),
                ("Cognito", 3000, colors.HexColor("#A7F3D0")),
                ("S3", 3000, colors.HexColor("#FDE68A")),
                ("CloudWatch Logs", 3000, colors.HexColor("#FCA5A5")),
            ],
            30000,
            "円",
        )
    )

    story += section_title("5. 身体的負担軽減と現場投資", ss)
    story.append(
        data_table(
            ["対策", "初期費用仮置き", "期待効果"],
            [
                ["スマホ・タブレットホルダー", "1人 3,000〜8,000円", "地図確認時に端末を取り出す回数を削減"],
                ["折り畳み自転車", "1人 3万〜8万円", "徒歩1万歩超の移動負担を軽減し、短距離訪問の回転率を上げる"],
                ["モバイルバッテリー", "1人 3,000〜8,000円", "タブレット運用時の電池切れを防ぐ"],
                ["ショルダー・耐衝撃ケース", "1人 5,000〜15,000円", "立ったまま確認しやすくし、落下リスクを下げる"],
            ],
            [48, 38, 82],
            ss,
            ACCENT_BLUE,
        )
    )

    story += section_title("6. 現時点の検証状況", ss)
    story.append(
        data_table(
            ["観点", "結果"],
            [
                ["自動テスト", "6ファイル、13テスト成功。CSV、重複警告、ルート最適化、訪問結果変換を確認"],
                ["品質チェック", "TypeScript、lint、GitHub Pages向けbuildが成功"],
                ["ブラウザ確認", "ログイン、管理者/営業担当者切替、検索・フィルタ、地図タップ、訪問予定、ルート最適化、全画面地図、ヘッダー導線、未決定理由、仮説検証注釈を確認"],
                ["サンプルデータ", f"地点{stats.locations}件、訪問履歴{stats.visit_records}件、訪問予定{stats.visit_plans}件、訪問予定明細{stats.visit_plan_items}件、未決定理由ログ{stats.decision_logs}件"],
                ["公開状況", f"GitHub Pagesで公開済み: {APP_URL}"],
            ],
            [45, 123],
            ss,
            ACCENT_BLUE,
        )
    )

    story += section_title("7. 次フェーズの判断ポイント", ss)
    story.append(
        callout(
            "推奨判断: 小規模現場パイロットを行い、実地図APIの見積り、運用定着率、削減時間、追加訪問件数、成約率への影響を測定する。",
            ss,
            fill=PALE_GREEN,
            border=ACCENT_GREEN,
        )
    )
    story += bullets(
        [
            "AWS認証・保存: Cognito、DynamoDB、S3、監査ログを接続する。",
            "地図API: Amazon Location Service、ZENRIN等の住宅地図API、ルート最適化APIの費用を見積もる。",
            "運用設計: 訪問NG、個人情報、削除履歴、担当者変更、端末紛失時の対応を定義する。",
            "ナレッジ運用: 未決定理由、採用/未採用理由、営業周知、対策結果の見直しを監査ログとして共有する。",
            "効果測定: 紙地図確認時間、徒歩移動負担、訪問予定作成時間、追加訪問枠、成約率を月次で追う。",
            "E2Eテスト: ログインから訪問予定作成・訪問結果登録までの自動検証を追加する。",
        ],
        ss["bullet"],
    )

    doc = doc_template(out, "経営層向け説明資料", ACCENT_BLUE)
    doc.build(story, onFirstPage=on_page("経営層向け説明資料", ACCENT_BLUE), onLaterPages=on_page("経営層向け説明資料", ACCENT_BLUE))
    return out


def build_user_pdf(stats: AppStats) -> Path:
    out = OUT_DIR / "user-guide.pdf"
    ss = styles(ACCENT_GREEN)
    story = []
    story += cover(
        "使用者向け説明資料",
        "営業用地図アプリ MVP / 日々の使い方・訪問予定・現場入力",
        "User Guide",
        ss,
        ACCENT_GREEN,
    )

    story += section_title("1. このアプリでできること", ss)
    story.append(
        callout(
            "紙地図の代わりに、訪問先を地図上のピンで確認し、訪問予定を作り、訪問結果・メモ・次回アクションを残すためのMVPです。"
            "緯度経度を人が入力する必要はありません。住所入力または地図タップで位置が入ります。",
            ss,
            fill=PALE_GREEN,
            border=ACCENT_GREEN,
        )
    )
    story.append(
        kpi_grid(
            [
                (f"{stats.locations}件", "サンプル地点"),
                (f"{stats.visit_records}件", "訪問履歴"),
                (f"{stats.visit_plans}件", "訪問予定"),
                (f"{stats.decision_logs}件", "未決定理由ログ"),
            ],
            ss,
            ACCENT_GREEN,
        )
    )
    story += bullets(
        [
            "ログイン画面で管理者または営業担当者を選びます。",
            "地図上のピンはステータス別に色分けされます。",
            "検索、ステータス、担当者で絞り込めます。",
            "地点詳細から訪問履歴、手書きメモ、編集、論理削除ができます。",
            "訪問予定は地図上で複数ピンを選び、まとめて追加できます。",
            "ヘッダーのショートカットから、地図、入力、訪問予定へすぐ移動できます。",
            "決まらない理由は未決定理由・対策案として残し、管理者へ共有できます。",
        ],
        ss["bullet"],
    )

    story += section_title("2. 1日の基本操作", ss)
    story.append(
        StepFlow(
            ["ログイン/担当確認", "今日の予定/確認", "地図で候補/選択", "ルート/最適化", "訪問結果/記録", "次回対応/保存"],
            ACCENT_GREEN,
        )
    )
    story.append(Spacer(1, 2 * mm))
    story.append(
        data_table(
            ["手順", "操作", "見るポイント"],
            [
                ["1", "ログイン画面で自分のユーザーを選ぶ", "営業担当者は自分の担当エリア中心に表示されます"],
                ["2", "ヘッダーの地図・入力・訪問予定を使う", "今やりたい作業の場所へすぐ移動できます"],
                ["3", "検索・フィルタで対象地点を絞る", "住所、顧客名、ステータス、担当者で絞り込みます"],
                ["4", "地図で選ぶをオンにしてピンを複数選択", "件数が多い日でも、詳細を1件ずつ開かずに予定へ追加できます"],
                ["5", "ルート最適化を実行", "訪問順、総距離、推定時間、ルート線を確認します"],
                ["6", "訪問後に履歴や未決定理由を追加", "結果、次回アクション、決まらない理由、対策案を残します"],
            ],
            [14, 66, 88],
            ss,
            ACCENT_GREEN,
        )
    )

    story += section_title("3. 地図画面の見方", ss)
    story.append(
        StatusDots(
            [
                ("施工済み", "定期点検・保証対応の対象", "#2563EB"),
                ("点検予定", "予定日や期限超過を確認", "#D97706"),
                ("訪問済み", "直近対応済み", "#16A34A"),
                ("不在", "再訪問候補", "#F97316"),
                ("見込みあり", "商談・見積候補", "#8B5CF6"),
                ("契約済み", "施工調整へ進む", "#059669"),
                ("訪問NG", "予定追加時も注意", "#DC2626"),
                ("未訪問", "新規候補", "#64748B"),
                ("失注", "再接触条件を確認", "#334155"),
            ]
        )
    )
    story += bullets(
        [
            "地図右上の「全画面」で、地図を画面いっぱいにして作業できます。戻るボタンまたはEscで通常画面に戻ります。",
            "地図タップは地点追加時の位置指定に使えます。住所から自動計算することもできます。",
            "ピンを選択すると地点詳細が開き、訪問履歴・メモ・編集へ進めます。",
            "訪問NGや重複候補の警告が出た場合は、その場で判断せず管理者確認を優先してください。",
        ],
        ss["bullet"],
    )

    story += section_title("4. 地点を追加・編集する", ss)
    story.append(
        data_table(
            ["項目", "入力・操作", "注意"],
            [
                ["顧客名", "訪問先の名前を入力", "同姓同名や表記ゆれはメモで補足します"],
                ["住所", "住所を入力して位置を計算", "緯度経度を直接入力する必要はありません"],
                ["位置", "住所から計算、または地図タップ", "保存時に未指定なら住所から再計算を試みます"],
                ["ステータス", "未訪問、点検予定、不在、見込みあり等を選択", "訪問結果を登録すると更新される場合があります"],
                ["メモ・タグ", "現場で見たこと、次回注意点を記録", "個人情報の扱いに注意します"],
            ],
            [31, 65, 72],
            ss,
            ACCENT_GREEN,
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(
        callout(
            "登録・予定追加時に、同住所、近接地点、顧客名類似、施工済み、点検予定、訪問NGの候補が出ることがあります。"
            "MVPでは登録を止めずに注意表示しますが、訪問前に必ず内容を確認してください。",
            ss,
            fill=PALE_AMBER,
            border=ACCENT_AMBER,
        )
    )

    story += section_title("5. 訪問予定を作る", ss)
    story += bullets(
        [
            "訪問予定パネルで日付を確認し、地図または地点一覧から候補を選びます。",
            "「地図で選ぶ」をオンにすると、地図上のピンを複数選択できます。",
            "「選択地点を追加」でまとめて訪問予定へ入れます。",
            "上下ボタンで訪問順を調整できます。",
            "2件以上ある場合は「ルート最適化」を使い、近い順の候補ルートを確認します。",
            "180件規模の候補がある日は、検索・フィルタ・地図選択を組み合わせて、先にまとまりを作ってから順番を調整します。",
        ],
        ss["bullet"],
    )
    story.append(
        data_table(
            ["場面", "おすすめ操作"],
            [
                ["点検予定が多い日", "ステータスを点検予定に絞り、期限が近い順に確認"],
                ["不在再訪問をまとめたい日", "不在ステータスで絞り、近いエリアのピンを地図で複数選択"],
                ["訪問NGを避けたい日", "訪問NG警告が出た地点は予定に入れる前に管理者へ確認"],
                ["移動距離を抑えたい日", "予定に追加後、ルート最適化で順番と推定時間を確認"],
            ],
            [48, 120],
            ss,
            ACCENT_GREEN,
        )
    )

    story += section_title("6. 訪問後に記録する", ss)
    story.append(
        data_table(
            ["記録するもの", "内容"],
            [
                ["訪問日時", "実際に訪問した日時を残します"],
                ["訪問結果", "訪問済み、不在、見込みあり、契約済み、失注、訪問NGなど"],
                ["次回アクション日", "再訪問、点検案内、見積送付などの予定日"],
                ["メモ", "現場で聞いたこと、注意点、管理者への共有事項"],
                ["手書きメモ", "床下・外周などの簡易メモをCanvasで残せます"],
            ],
            [45, 123],
            ss,
            ACCENT_GREEN,
        )
    )
    story += bullets(
        [
            "保存すると、地点の最終訪問日とステータスも更新されます。",
            "手書きメモはMVPではブラウザ内に保存されます。本番ではS3保存へ移行予定です。",
            "訪問NGや個人情報に関わる内容は、メモの書き方と共有範囲に注意してください。",
        ],
        ss["bullet"],
    )

    story += section_title("7. 未決定理由と対策案を残す", ss)
    story.append(
        callout(
            "商談や点検案内が決まらない理由には、次の対策を考えるためのリスクとノウハウが含まれます。"
            "地点詳細の「未決定理由・対策案」から、理由、リスク、対策案、優先度を登録してください。",
            ss,
            fill=PALE_AMBER,
            border=ACCENT_AMBER,
        )
    )
    story += bullets(
        [
            "仮説は効果がまだ確定していないため、最初は複数出して構いません。",
            "対策案はいくつ出しても構いませんが、現場の運用負荷が増えすぎないように優先度を決めます。",
            "重要な対策から順に実行し、実行後は結果を記録して定期的に見直します。",
            "管理者が採用した対策は、営業画面の決定事項として周知されます。",
            "未採用になった対策も、理由を残すことで次の判断材料になります。",
        ],
        ss["bullet"],
    )

    story += section_title("8. 管理者と営業担当者の違い", ss)
    story.append(
        data_table(
            ["利用者", "主な画面", "主な目的"],
            [
                ["管理者", "KPI、未決定理由、システム管理、担当者切り替え、CSV入出力", "全体状況、担当者別件数、重複候補、ナレッジ、データ品質を確認する"],
                ["営業担当者", "自分の担当者・担当エリア中心の地図、入力、訪問予定、今日の作業サマリー", "日々の訪問候補確認、予定作成、訪問結果・未決定理由の登録を行う"],
            ],
            [32, 68, 68],
            ss,
            ACCENT_GREEN,
        )
    )

    story += section_title("9. MVP利用時の注意", ss)
    story.append(
        callout(
            "GitHub Pages版はサーバーAPIがないため、画面操作で追加・編集したデータはブラウザ内のlocalStorageに保存されます。"
            "端末やブラウザを変えると同じ操作データが見えない場合があります。本番運用ではAWS保存へ移行します。",
            ss,
            fill=PALE_RED,
            border=ACCENT_RED,
        )
    )
    story += bullets(
        [
            "本番利用前はCognito認証、DynamoDB保存、S3保存、監査ログを追加します。",
            "実地図APIや住宅地図APIは未接続です。現段階ではMockMapProviderの地図風UIです。",
            "地図API費用は契約・利用量・住宅地図精度により変わるため要見積りです。",
            "試験利用時は、実顧客の個人情報を扱う範囲を事前に決めてください。",
            "不明点、訪問NG、重複候補、期限超過は管理者へ確認してください。",
        ],
        ss["bullet"],
    )

    doc = doc_template(out, "使用者向け説明資料", ACCENT_GREEN)
    doc.build(story, onFirstPage=on_page("使用者向け説明資料", ACCENT_GREEN), onLaterPages=on_page("使用者向け説明資料", ACCENT_GREEN))
    return out


def main() -> None:
    register_fonts()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stats = load_stats()
    paths = [build_management_pdf(stats), build_user_pdf(stats)]
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
