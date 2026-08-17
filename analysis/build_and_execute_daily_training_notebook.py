from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path


OUTPUT_PATH = Path(__file__).with_name("daily_autonomous_training_2026-08-14.ipynb")


def markdown(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": source.splitlines(keepends=True),
    }


def code(source: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source.splitlines(keepends=True),
    }


SOURCE_SQL = """with bounds as (
  select min(local_date) as start_date,
         ((now() at time zone 'Asia/Taipei')::date - 1) as end_date
  from public.student_check_ins
),
calendar as (
  select generate_series(start_date, end_date, interval '1 day')::date as local_date
  from bounds
),
daily as (
  select local_date,
         count(distinct student_profile_id)::int as unique_people,
         count(*)::int as entry_records,
         count(*) filter (where daily_sequence > 1)::int as repeat_entry_records
  from public.student_check_ins
  group by local_date
),
closures as (
  select business_date,
         bool_or(is_closed) as is_closed,
         string_agg(distinct closure_label, '、') filter (where closure_label is not null) as closure_label
  from public.bige_business_day_settings
  group by business_date
)
select c.local_date,
       extract(isodow from c.local_date)::int as iso_weekday,
       coalesce(d.unique_people, 0) as unique_people,
       coalesce(d.entry_records, 0) as entry_records,
       coalesce(d.repeat_entry_records, 0) as repeat_entry_records,
       coalesce(cl.is_closed, false) as is_closed,
       cl.closure_label
from calendar c
left join daily d using (local_date)
left join closures cl on cl.business_date = c.local_date
order by c.local_date;"""


DAILY_ROWS = [
    {"local_date": "2026-07-17", "weekday": "週五", "iso_weekday": 5, "unique_people": 1, "entry_records": 2, "repeat_entry_records": 1, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-18", "weekday": "週六", "iso_weekday": 6, "unique_people": 5, "entry_records": 8, "repeat_entry_records": 3, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-19", "weekday": "週日", "iso_weekday": 7, "unique_people": 5, "entry_records": 6, "repeat_entry_records": 1, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-20", "weekday": "週一", "iso_weekday": 1, "unique_people": 8, "entry_records": 8, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-21", "weekday": "週二", "iso_weekday": 2, "unique_people": 8, "entry_records": 8, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-22", "weekday": "週三", "iso_weekday": 3, "unique_people": 12, "entry_records": 13, "repeat_entry_records": 1, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-23", "weekday": "週四", "iso_weekday": 4, "unique_people": 6, "entry_records": 6, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-24", "weekday": "週五", "iso_weekday": 5, "unique_people": 6, "entry_records": 6, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-25", "weekday": "週六", "iso_weekday": 6, "unique_people": 8, "entry_records": 8, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-26", "weekday": "週日", "iso_weekday": 7, "unique_people": 7, "entry_records": 7, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-27", "weekday": "週一", "iso_weekday": 1, "unique_people": 5, "entry_records": 5, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-28", "weekday": "週二", "iso_weekday": 2, "unique_people": 7, "entry_records": 8, "repeat_entry_records": 1, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-29", "weekday": "週三", "iso_weekday": 3, "unique_people": 6, "entry_records": 6, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-30", "weekday": "週四", "iso_weekday": 4, "unique_people": 10, "entry_records": 10, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-07-31", "weekday": "週五", "iso_weekday": 5, "unique_people": 6, "entry_records": 6, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-01", "weekday": "週六", "iso_weekday": 6, "unique_people": 7, "entry_records": 7, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-02", "weekday": "週日", "iso_weekday": 7, "unique_people": 5, "entry_records": 5, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-03", "weekday": "週一", "iso_weekday": 1, "unique_people": 6, "entry_records": 6, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-04", "weekday": "週二", "iso_weekday": 2, "unique_people": 11, "entry_records": 12, "repeat_entry_records": 1, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-05", "weekday": "週三", "iso_weekday": 3, "unique_people": 11, "entry_records": 11, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-06", "weekday": "週四", "iso_weekday": 4, "unique_people": 7, "entry_records": 7, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-07", "weekday": "週五", "iso_weekday": 5, "unique_people": 10, "entry_records": 10, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-08", "weekday": "週六", "iso_weekday": 6, "unique_people": 10, "entry_records": 10, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-09", "weekday": "週日", "iso_weekday": 7, "unique_people": 0, "entry_records": 0, "repeat_entry_records": 0, "is_closed": True, "closure_label": "館休"},
    {"local_date": "2026-08-10", "weekday": "週一", "iso_weekday": 1, "unique_people": 8, "entry_records": 8, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-11", "weekday": "週二", "iso_weekday": 2, "unique_people": 12, "entry_records": 13, "repeat_entry_records": 1, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-12", "weekday": "週三", "iso_weekday": 3, "unique_people": 8, "entry_records": 8, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
    {"local_date": "2026-08-13", "weekday": "週四", "iso_weekday": 4, "unique_people": 7, "entry_records": 7, "repeat_entry_records": 0, "is_closed": False, "closure_label": None},
]


cells = [
    markdown("""## tl;dr

- 2026/7/17–2026/8/13 的 27 個營業日，平均每日 **7.48 位**不重複自主訓練入場者。
- 若把 8/9 館休日也納入 28 個完整日曆日，平均為 **7.21 位／日**。
- 週二（9.50 位）與週三（9.25 位）平均最高；週五（5.75 位）最低。
"""),
    markdown("""## Context & Methods

本分析供館方了解「學生自主訓練」的每日平均入場人數。人數定義為同一台北日期內不重複的 `student_profile_id`；同一學生同日再次入場不重複計人，但保留為實際入場紀錄供核對。

### Key Assumptions

- 權威來源為 BIGE 正式 Supabase 的 `public.student_check_ins`。
- 日期以表內的台北日期 `local_date` 為準。
- 2026/8/14 查詢當下為台北時間清晨 4:47，排除未完成的當日。
- 營業日平均排除 `public.bige_business_day_settings` 中 2026/8/9 的館休日。
"""),
    markdown("""## Data

資料為 2026/8/14 04:47（Asia/Taipei）查得的無個資日彙總快照。來源查詢保留在下一個程式碼儲存格，方便稽核與重跑。
"""),
    code(f"SOURCE_SQL = {SOURCE_SQL!r}\nDAILY_ROWS = {DAILY_ROWS!r}\nprint(f'已載入 {{len(DAILY_ROWS)}} 個完整日曆日的日彙總快照。')"),
    markdown("""## Results

以下從日彙總快照重新計算營業日平均、日曆日平均、實際入場紀錄平均與每日清單。
"""),
    code("""from collections import defaultdict
from statistics import mean, median

operating_rows = [row for row in DAILY_ROWS if not row["is_closed"]]
summary = {
    "calendar_days": len(DAILY_ROWS),
    "operating_days": len(operating_rows),
    "unique_person_days": sum(row["unique_people"] for row in DAILY_ROWS),
    "entry_records": sum(row["entry_records"] for row in DAILY_ROWS),
    "avg_people_calendar": mean(row["unique_people"] for row in DAILY_ROWS),
    "avg_people_operating": mean(row["unique_people"] for row in operating_rows),
    "avg_entries_operating": mean(row["entry_records"] for row in operating_rows),
    "median_people_operating": median(row["unique_people"] for row in operating_rows),
    "max_people": max(row["unique_people"] for row in operating_rows),
}

print(f'營業日平均不重複人數：{summary["avg_people_operating"]:.2f} 位／日')
print(f'完整日曆日平均不重複人數：{summary["avg_people_calendar"]:.2f} 位／日')
print(f'營業日平均實際入場紀錄：{summary["avg_entries_operating"]:.2f} 次／日')
print(f'營業日中位數：{summary["median_people_operating"]:.0f} 位；單日最高：{summary["max_people"]} 位')
"""),
    code("""print('日期        星期  人數  入場次數  備註')
for row in DAILY_ROWS:
    note = row["closure_label"] or (f'同日重複 {row["repeat_entry_records"]} 次' if row["repeat_entry_records"] else '')
    print(f'{row["local_date"]}  {row["weekday"]}  {row["unique_people"]:>2}    {row["entry_records"]:>2}      {note}')
"""),
    code("""weekday_rows = defaultdict(list)
for row in operating_rows:
    weekday_rows[row["iso_weekday"]].append(row)

print('星期  營業日數  平均人數  平均入場次數')
for iso_weekday in range(1, 8):
    rows = weekday_rows[iso_weekday]
    label = rows[0]["weekday"]
    avg_people = mean(row["unique_people"] for row in rows)
    avg_entries = mean(row["entry_records"] for row in rows)
    print(f'{label}     {len(rows):>2}      {avg_people:>5.2f}       {avg_entries:>5.2f}')
"""),
    markdown("""## Takeaways

- 平常營業日可先以約 **7–8 位／日**作為自主訓練的人流基準。
- 週二、週三平均約 **9–10 位**，是目前較需要留意櫃檯核對與器材使用量的日子。
- 目前只有四週資料；星期別平均每個星期僅 3–4 個樣本，適合做初步排班參考，尚不宜當長期定論。
"""),
    code("""assert DAILY_ROWS[0]["local_date"] == "2026-07-17"
assert DAILY_ROWS[-1]["local_date"] == "2026-08-13"
assert summary["calendar_days"] == 28
assert summary["operating_days"] == 27
assert summary["unique_person_days"] == 202
assert summary["entry_records"] == 211
assert sum(row["repeat_entry_records"] for row in DAILY_ROWS) == 9
assert round(summary["avg_people_operating"], 2) == 7.48
assert round(summary["avg_people_calendar"], 2) == 7.21
print('驗算通過：日期範圍、日數、總人次、重複入場與平均值均一致。')
"""),
]


notebook = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3"},
        "source": {
            "project": "BIGE",
            "supabase_project_ref": "xtacrcqosjobaqxvibvi",
            "tables": ["public.student_check_ins", "public.bige_business_day_settings"],
            "snapshot_at": "2026-08-14T04:47:43+08:00",
        },
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}


namespace: dict = {}
execution_count = 0
for cell in notebook["cells"]:
    if cell["cell_type"] != "code":
        continue
    execution_count += 1
    source = "".join(cell["source"])
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(compile(source, f"{OUTPUT_PATH.name}:cell-{execution_count}", "exec"), namespace, namespace)
    cell["execution_count"] = execution_count
    text_output = output.getvalue()
    if text_output:
        cell["outputs"] = [{"name": "stdout", "output_type": "stream", "text": text_output.splitlines(keepends=True)}]


assert notebook["nbformat"] == 4
assert all(cell["cell_type"] in {"markdown", "code"} for cell in notebook["cells"])
assert all(cell["execution_count"] is not None for cell in notebook["cells"] if cell["cell_type"] == "code")
OUTPUT_PATH.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"Wrote and executed {OUTPUT_PATH}")
