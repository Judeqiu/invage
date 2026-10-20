"""Bridge fee queries work without a local SDK/pandas installation."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("opend_bridge", Path(__file__).parents[1] / "src/futubull/opend_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class OpenDFeesTest(unittest.TestCase):
    def test_batches_deduplicated_parents_and_preserves_partial_success(self):
        context = SimpleNamespace(order_fee_query=Mock(side_effect=[(0, [{"order_id": "0", "fee_amount": "1.23"}]), (1, "unsupported")]))
        sdk = SimpleNamespace(RET_OK=0, TrdEnv=SimpleNamespace(REAL="REAL"))
        deals = [{"order_id": str(i)} for i in range(401)] + [{"order_id": "0"}]
        with patch.object(bridge, "rows", side_effect=lambda rows: rows), patch.object(bridge.time, "sleep") as sleep:
            fees, gaps = bridge.fetch_order_fees(context, deals, 123, sdk)
        self.assertEqual(fees, [{"order_id": "0", "fee_amount": "1.23"}])
        self.assertEqual(len(gaps), 1)
        self.assertEqual(context.order_fee_query.call_count, 2)
        batches = [call.kwargs for call in context.order_fee_query.call_args_list]
        self.assertEqual([len(batch["order_id_list"]) for batch in batches], [400, 1])
        self.assertTrue(all(batch["acc_id"] == 123 and batch["trd_env"] == "REAL" for batch in batches))
        sleep.assert_called_once_with(3.1)

    def test_old_sdk_retains_unknown_fees_without_failing_history(self):
        sdk = SimpleNamespace(RET_OK=0, TrdEnv=SimpleNamespace(REAL="REAL"))
        fees, gaps = bridge.fetch_order_fees(SimpleNamespace(), [{"order_id": "1234567890123456789"}], 1, sdk)
        self.assertEqual(fees, [])
        self.assertEqual(gaps[0]["reference"], "1234567890123456789")


if __name__ == "__main__":
    unittest.main()
