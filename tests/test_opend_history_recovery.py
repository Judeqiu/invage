import contextlib
import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('opend_bridge', Path(__file__).parents[1] / 'src/futubull/opend_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class HistoryRecovery(unittest.TestCase):
    def test_history_exception_keeps_the_previously_read_snapshot(self):
        class Context:
            def get_acc_list(self): return 0, [{'acc_id': '1', 'trd_env': 'REAL'}]
            def accinfo_query(self, **kw): return 0, [{'cash': '100'}]
            def position_list_query(self, **kw): return 0, []
            def history_deal_list_query(self, **kw): raise RuntimeError('history timeout')
            def close(self): pass
        futu = types.SimpleNamespace(SecurityFirm=types.SimpleNamespace(FUTUSG='FUTUSG'),
            TrdMarket=types.SimpleNamespace(NONE='NONE'), TrdEnv=types.SimpleNamespace(REAL='REAL'),
            RET_OK=0, OpenSecTradeContext=lambda **kw: Context())
        request = {'security_firm':'FUTUSG', 'opend_port':11111, 'mode':'snapshot','acc_id':'1',
            'history':{'from':'2026-10-01T00:00:00Z','through':'2026-10-23T00:00:00Z'}}
        output = io.StringIO()
        with patch.dict(sys.modules, {'futu':futu}), patch.object(bridge, 'rows', lambda frame:frame), patch.object(bridge.json, 'load', return_value=request), contextlib.redirect_stdout(output):
            bridge.main()
        records = [json.loads(line[len(bridge.MARKER):]) for line in output.getvalue().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertEqual(records[-1]['funds'], [{'cash':'100'}])
        self.assertEqual(records[-1]['positions'], [])
        self.assertIn('history_error', records[-1])
        self.assertNotIn('error', records[-1])

if __name__ == '__main__': unittest.main()
