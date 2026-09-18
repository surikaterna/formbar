import fcntl
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
COMMAND = ["node", "--import", "tsx", "apps/tui-interaction-spike/src/manual.tsx"]


def resize(fd: int, rows: int, columns: int) -> None:
	fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))


def send(fd: int, value: bytes) -> None:
	os.write(fd, value)
	time.sleep(0.3)


def become_session_leader() -> None:
	os.setsid()
	fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def read_until(fd: int, output: bytearray, marker: bytes, timeout: float) -> bool:
	deadline = time.time() + timeout
	while time.time() < deadline:
		ready, _, _ = select.select([fd], [], [], 0.2)
		if ready:
			try:
				output.extend(os.read(fd, 65536))
			except OSError:
				break
			if marker in output:
				return True
	return False


def drain(fd: int, output: bytearray, process: subprocess.Popen[bytes]) -> None:
	deadline = time.time() + 15
	while time.time() < deadline:
		ready, _, _ = select.select([fd], [], [], 0.2)
		if ready:
			try:
				output.extend(os.read(fd, 65536))
			except OSError:
				break
		elif process.poll() is not None:
			break


def main() -> int:
	master, slave = pty.openpty()
	original_lflag = termios.tcgetattr(slave)[3]
	resize(master, 30, 90)
	process = subprocess.Popen(
		COMMAND,
		cwd=ROOT,
		stdin=slave,
		stdout=slave,
		stderr=slave,
		close_fds=True,
		preexec_fn=become_session_leader,
	)
	os.close(slave)
	output = bytearray()
	if not read_until(master, output, b"Enter: Enter identity", 10):
		process.terminate()
		process.wait(timeout=5)
		sys.stderr.write(output.decode("utf-8", errors="replace"))
		sys.stderr.write(f"manual exited before first frame: {process.returncode}\n")
		return 1
	for value in [b"\r", b"X", b"\x1b[D", "👩‍💻".encode(), b"\x08", b"\x1b[3~", b"X", b"\r", b"\t", b"\x08", b"\x08", b"42", b"\r", b"\x1b"]:
		send(master, value)
	resize(master, 30, 42)
	for value in [b"\t", b"\r", b" ", b"\t", b"\r", b"cyan", b"\r", b"\x13"]:
		send(master, value)
	if not read_until(master, output, b"Submission: succeeded", 5):
		process.terminate()
		drain(master, output, process)
		sys.stderr.write(output.decode("utf-8", errors="replace"))
		sys.stderr.write("manual did not report successful submission\n")
		return 1
	send(master, b"\x03")
	drain(master, output, process)
	process.wait(timeout=5)
	restored_lflag = termios.tcgetattr(master)[3]
	text = output.decode("utf-8", errors="replace")
	expected = 'FINAL_JSON={"name":"AdaX","age":42,"enabled":false,"color":"cyan"}'
	if process.returncode != 0 or text.count("FINAL_JSON=") != 1 or expected not in text or restored_lflag != original_lflag:
		sys.stderr.write(text)
		return 1
	if not verify_single_field_tab():
		return 1
	print("PTY_OK resize=90->42 identity_enter=true immediate_text=true caret=true ink_backspace=true forward_delete=true emoji_backspace=true group_return=true preferences_enter=true boolean_space=true submit_ctrl_s=true submit_success=true ctrl_c=true raw_restored=true single_field_enter=true single_field_tab=true final_json_unchanged=true final_json_once=true")
	return 0


def verify_single_field_tab() -> bool:
	master, slave = pty.openpty()
	environment = {**os.environ, "FORMBAR_TUI_SINGLE_FIELD": "1"}
	process = subprocess.Popen(COMMAND, cwd=ROOT, env=environment, stdin=slave, stdout=slave, stderr=slave, close_fds=True, preexec_fn=become_session_leader)
	os.close(slave)
	output = bytearray()
	if not read_until(master, output, b"Enter: Enter General", 10):
		process.terminate()
		return False
	for value in [b"\r", b"X", b"\t"]:
		send(master, value)
	handled = read_until(master, output, b"Enter: Activate name", 5)
	send(master, b"\x03")
	drain(master, output, process)
	process.wait(timeout=5)
	text = output.decode("utf-8", errors="replace")
	return handled and process.returncode == 0 and 'FINAL_JSON={"name":"AdaX"' in text


if __name__ == "__main__":
	raise SystemExit(main())
