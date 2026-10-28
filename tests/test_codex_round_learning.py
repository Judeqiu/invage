import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "codex_round_learning.py"
spec = importlib.util.spec_from_file_location("round_learning", SCRIPT)
learning = importlib.util.module_from_spec(spec)
spec.loader.exec_module(learning)


class RoundLearningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = learning.Store(self.temp.name)
        self.event = {
            "session_id": "session-1", "turn_id": "turn-1", "tool_use_id": "tool-1",
            "cwd": str(learning.PROJECT),
            "tool_input": {"command": "ssh host 'systemctl status app'; secret-placeholder"},
            "tool_response": {"exit_code": 1, "output": "Failed at step CHDIR: Permission denied"},
        }

    def test_observation_remembers_fix_without_storing_raw_commands_or_output(self):
        with self.store.locked():
            learning.observe(self.store, self.event)
        lessons = self.store.load("lessons.json", [])
        self.assertEqual(len(lessons), 1)
        self.assertIn("0755", lessons[0]["lesson"])
        self.assertEqual(lessons[0]["occurrences"], 1)
        state = self.store.load(learning.round_name(self.event), {})
        self.assertEqual(state["failed_calls"], 1)
        for path in Path(self.temp.name).rglob("*.json"):
            self.assertNotIn("secret-placeholder", path.read_text())
            self.assertNotIn(self.event["tool_response"]["output"], path.read_text())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_duplicate_events_do_not_inflate_counters(self):
        learning.observe(self.store, self.event)
        learning.observe(self.store, self.event)
        state = self.store.load(learning.round_name(self.event), {})
        self.assertEqual(state["shell_calls"], 1)
        self.assertEqual(self.store.load("lessons.json", [])[0]["occurrences"], 1)

    def test_finish_counts_repeats_once_without_blocking_or_continuing_the_agent(self):
        learning.observe(self.store, self.event)
        learning.observe(self.store, {**self.event, "tool_use_id": "tool-2"})
        learning.finish(self.store, self.event)
        first = self.store.load(learning.round_name(self.event), {})
        learning.finish(self.store, self.event)
        self.assertEqual(first, self.store.load(learning.round_name(self.event), {}))
        self.assertEqual(first["repeated_commands"], 1)
        self.assertGreaterEqual(first["elapsed_seconds"], 0)

    def test_recall_filters_by_task_topic_and_retains_every_lesson(self):
        self.store.remember("deploy", "Deploy fix", "Preserve permissions", "observed")
        self.store.remember("test", "Test fix", "Use tests directory", "observed")
        self.store.remember("general", "General fix", "Use a focused first check", "observed")
        message = learning.context(self.store, "deploy the change")
        self.assertIn("2 relevant of 3 stored", message)
        self.assertIn("Deploy fix", message)
        self.assertIn("General fix", message)
        self.assertNotIn("Test fix:", message)
        self.assertEqual(len(self.store.load("lessons.json", [])), 3)
        self.assertIn("Test fix:", learning.context(self.store, "run tests"))

    def test_new_evidence_is_deduplicated_without_losing_revisions(self):
        for evidence in ["round 1", "round 1", "round 2"]:
            self.store.remember("test", "Test fix", "Use tests directory", evidence)
        self.store.remember("test", "Test fix", "Use the main tests directory explicitly", "round 3")
        lessons = self.store.load("lessons.json", [])
        self.assertEqual(len(lessons), 2)
        self.assertEqual(lessons[0]["occurrences"], 2)
        self.assertEqual(lessons[0]["evidence"], ["round 1", "round 2"])

    def test_other_project_and_malformed_input_are_nonblocking(self):
        for event in [{"cwd": self.temp.name}, None]:
            payload = json.dumps(event) if event is not None else "invalid JSON"
            result = subprocess.run(["python3", str(SCRIPT), "observe"], input=payload,
                                    text=True, capture_output=True, check=True)
            output = json.loads(result.stdout)
            self.assertNotIn("decision", output)
            self.assertNotEqual(output.get("continue"), False)
            self.assertNotIn("invalid JSON", result.stdout)

    def test_transcript_is_never_read_or_executed(self):
        event = {**self.event, "transcript_path": "/no/such/file", "tool_input": {"cmd": "$(touch /not-executed)"}}
        learning.observe(self.store, event)
        state = self.store.load(learning.round_name(event), {})
        self.assertEqual(state["shell_calls"], 1)
        self.assertNotIn("touch", json.dumps(state))

    def test_success_does_not_create_a_speculative_lesson(self):
        learning.observe(self.store, {**self.event, "tool_response": {"exit_code": 0, "output": "Tests passed"}})
        self.assertEqual(self.store.load("lessons.json", []), [])
        learning.observe(self.store, {**self.event, "tool_use_id": "tool-2", "tool_response": {"exit_code": 0, "output": "Documentation example: Failed at step CHDIR"}})
        self.assertEqual(self.store.load("lessons.json", []), [])

    def test_nested_tool_response_exit_codes_are_counted(self):
        response = {"content": [{"type": "text", "text": json.dumps({"exit_code": 1, "output": "failed"})}]}
        self.assertTrue(learning.response_failed(response, ""))

    def test_project_configuration_uses_three_nonblocking_hooks(self):
        config = json.loads((learning.PROJECT / ".codex" / "hooks.json").read_text())
        self.assertEqual(set(config["hooks"]), {"PostToolUse", "Stop", "UserPromptSubmit"})
        for groups in config["hooks"].values():
            for group in groups:
                for hook in group["hooks"]:
                    self.assertIn("scripts/codex_round_learning.py", hook["command"])
                    self.assertNotIn("dangerously", hook["command"])

    def test_fatal_diagnostic_is_seen_even_with_exit_zero_in_a_nested_response(self):
        response = {"content": [{"type": "text", "text": json.dumps({
            "exit_code": 0, "output": "[FATAL] Uncaught Exception: validation failed\nprivate-placeholder"})}]}
        event = {**self.event, "tool_response": response}
        learning.observe(self.store, event)
        self.assertEqual(self.store.load(learning.round_name(event), {})["failed_calls"], 1)
        lessons = self.store.load("lessons.json", [])
        self.assertIn("structured success", lessons[0]["title"])
        for path in Path(self.temp.name).rglob("*.json"):
            self.assertNotIn("private-placeholder", path.read_text())
        self.assertFalse(learning.response_failed({"exit_code": 0, "output":
            "Documentation example: [FATAL] Uncaught Exception: example"}))

    def test_a_yielded_session_is_not_a_completed_call_and_final_output_is_observed(self):
        learning.observe(self.store, {**self.event, "tool_response": {
            "session_id": 123, "output": "Script still running"}})
        self.assertIsNone(self.store.load(learning.round_name(self.event), None))
        learning.observe(self.store, self.event)
        self.assertEqual(self.store.load(learning.round_name(self.event), {})["failed_calls"], 1)

    def test_reviewed_seeds_are_idempotent_and_include_current_round_fixes(self):
        learning.seed(self.store)
        first = self.store.load("lessons.json", [])
        learning.seed(self.store)
        second = self.store.load("lessons.json", [])
        self.assertEqual(len(first), len(second))
        self.assertTrue(all(row["occurrences"] == 1 for row in second))
        message = learning.context(self.store, "validate broker fees and deploy the backup")
        self.assertIn("Preserve known facts while validating enrichment", message)
        self.assertIn("Check authentication before a historical backfill", message)
        self.assertIn("Benchmark and verify backup transfers", message)
        self.assertIn("Wait for complete asynchronous exports", message)
        for entry in learning.known_lessons():
            self.assertIn(entry["topic"], learning.TOPICS)

    def test_concurrent_hook_events_preserve_all_outcomes(self):
        from concurrent.futures import ThreadPoolExecutor
        def record(i):
            with self.store.locked():
                learning.observe(self.store, {**self.event, "tool_use_id": "concurrent-" + str(i)})
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(record, range(12)))
        state = self.store.load(learning.round_name(self.event), {})
        self.assertEqual(state["shell_calls"], 12)
        self.assertEqual(state["failed_calls"], 12)
        self.assertEqual(len(self.store.load("lessons.json", [])), 1)

    def test_recall_has_no_result_count_truncation(self):
        for i in range(30):
            self.store.remember("broker", "Lesson " + str(i), "Verified fix " + str(i), "observed")
        message = learning.context(self.store, "broker sync")
        self.assertIn("30 relevant of 30 stored", message)
        self.assertIn("Lesson 29:", message)
        self.assertIn("Lesson 0:", message)


if __name__ == "__main__":
    unittest.main()
