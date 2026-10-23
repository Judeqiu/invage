"""Small read-only bridge to the official Futu Python SDK.

Invage passes a JSON request on stdin and reads only the marked JSON result.
No trading unlock or order method is called here.
"""

import json
import sys
import time
from datetime import datetime, timezone

MARKER = "INVAGE_FUTU_JSON:"


def rows(frame):
    # pandas' JSON encoder handles numpy values and nulls consistently.
    exact_fields = ["acc_id", "deal_id", "order_id", "qty", "price", "dealt_qty", "dealt_avg_price", "contract_size", "lot_size", "multiplier", "fee_amount"]
    frame = frame.copy()
    for field in exact_fields:
        if field in frame.columns:
            frame[field] = frame[field].map(lambda value: None if value is None or str(value) == "nan" else str(value))
    if "fee_details" in frame.columns:
        frame["fee_details"] = frame["fee_details"].map(
            lambda value: [[str(label), str(amount)] for label, amount in value] if isinstance(value, (list, tuple)) else None)
    if "acc_id" in frame.columns:
        frame = frame.copy()
        frame["acc_id"] = frame["acc_id"].astype(str)
    result = json.loads(frame.to_json(orient="records"))
    for row in result:
        if "acc_id" in row and row["acc_id"] is not None:
            row["acc_id"] = str(row["acc_id"])
    return result


def require_ok(result, label, futu):
    status, data = result
    if status != futu.RET_OK:
        raise RuntimeError(f"OpenD {label} failed: {data}")
    return rows(data)


def fetch_order_fees(context, deals, account, futu):
    ids = sorted({str(row["order_id"]) for row in deals if row.get("order_id") is not None})
    fees, fee_gaps = [], []
    for offset in range(0, len(ids), 400):
        if offset:
            time.sleep(3.1)  # SDK limit: ten queries per thirty seconds.
        batch = ids[offset:offset + 400]
        try:
            fees.extend(require_ok(context.order_fee_query(order_id_list=batch,
                acc_id=account, trd_env=futu.TrdEnv.REAL), "order fees", futu))
        except Exception:
            fee_gaps.extend({"kind": "coverage", "reference": order_id,
                "reason": "OpenD order fees unavailable on this account/gateway; missing charges remain unknown."}
                for order_id in batch)
    return fees, fee_gaps


def main():
    request = json.load(sys.stdin)
    import futu

    firm = getattr(futu.SecurityFirm, request["security_firm"])
    context = futu.OpenSecTradeContext(
        filter_trdmarket=futu.TrdMarket.NONE,
        host="127.0.0.1",
        port=int(request["opend_port"]),
        security_firm=firm,
    )
    try:
        accounts = require_ok(context.get_acc_list(), "account discovery", futu)
        accounts = [row for row in accounts if str(row.get("trd_env", "")).upper() == "REAL"]
        if request["mode"] == "discover":
            output = {"accounts": accounts}
        else:
            account_id = request["acc_id"]
            if not any(row["acc_id"] == account_id for row in accounts):
                raise RuntimeError("Selected live Futubull account is not available in OpenD")
            account = int(account_id)
            funds = require_ok(context.accinfo_query(trd_env=futu.TrdEnv.REAL,
                                                     acc_id=account), "funds", futu)
            positions = require_ok(context.position_list_query(trd_env=futu.TrdEnv.REAL,
                                                               acc_id=account), "positions", futu)
            output = {"schema": "invage.futubull.raw.v1", "fetched_at": datetime.now(timezone.utc).isoformat(),
                      "acc_id": account_id, "funds": funds, "positions": positions}
            if request.get("history"):
                # Emit the validated core first so a history timeout/crash cannot erase it.
                print(MARKER + json.dumps({**output, "history_error": "OpenD history did not finish; retry historical enrichment."}, separators=(",", ":")), flush=True)
                try:
                    plan = request["history"]
                    bounds = {"start": plan["from"][:10] + " 00:00:00", "end": plan["through"][:10] + " 23:59:59",
                              "trd_env": futu.TrdEnv.REAL, "acc_id": account}
                    deals = require_ok(context.history_deal_list_query(**bounds), "historical deals", futu)
                    orders = require_ok(context.history_order_list_query(**bounds), "historical orders", futu)
                    # Read-only settled fee query, available on supported REAL gateways.
                    # Request only parents with observed fills; never invent zero fees.
                    fees, fee_gaps = fetch_order_fees(context, deals, account, futu)
                    output["history"] = {"plan": plan, "deals": deals, "orders": orders,
                                         "order_fees": fees, "fee_gaps": fee_gaps}
                except Exception:
                    output["history_error"] = "OpenD historical enrichment unavailable; retain current snapshot and retry history."

        print(MARKER + json.dumps(output, separators=(",", ":")))
    finally:
        context.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(MARKER + json.dumps({"error": str(error)}))
        sys.exit(1)
