"""Bounded, JSON-only review previews; never needed for a GitHub write to succeed."""
import hashlib
import json
from difflib import SequenceMatcher

MAX_INPUT_LINES = 2000
MAX_FILE_BYTES = 65536
MAX_PREVIEW_BYTES = 512 * 1024


def blob_sha(text):
    raw = text.encode('utf-8')
    return hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()


def line_content(line):
    for suffix, ending in (('\r\n', 'crlf'), ('\n', 'lf'), ('\r', 'cr')):
        if line.endswith(suffix):
            return line[:-len(suffix)], ending
    return line, 'none'


def unavailable(path, reason):
    # Unknown counts are null, never invented zeroes.
    return {'file_path': path, 'status': 'unavailable', 'reason': reason,
            'additions': None, 'deletions': None, 'issue_ids': [], 'hunks': []}


def file_preview(path, original, updated, issue_ids):
    old, new = original.splitlines(keepends=True), updated.splitlines(keepends=True)
    if len(old) + len(new) > MAX_INPUT_LINES:
        return unavailable(path, 'preview_limit')
    hunks, additions, deletions = [], 0, 0
    # The line budget bounds worst-case matching work as well as DOM size.
    matcher = SequenceMatcher(None, old, new, autojunk=True)
    for group in matcher.get_grouped_opcodes(3):
        first, last = group[0], group[-1]
        old_count, new_count = last[2] - first[1], last[4] - first[3]
        hunk = {'old_start': first[1] + (1 if old_count else 0), 'old_count': old_count,
                'new_start': first[3] + (1 if new_count else 0), 'new_count': new_count, 'lines': []}
        for tag, i1, i2, j1, j2 in group:
            if tag == 'equal':
                for offset, line in enumerate(old[i1:i2]):
                    text, ending = line_content(line)
                    hunk['lines'].append({'kind': 'context', 'old_line': i1+offset+1,
                        'new_line': j1+offset+1, 'text': text, 'ending': ending})
            else:
                for number in range(i1, i2):
                    text, ending = line_content(old[number])
                    hunk['lines'].append({'kind': 'delete', 'old_line': number+1,
                        'new_line': None, 'text': text, 'ending': ending})
                    deletions += 1
                for number in range(j1, j2):
                    text, ending = line_content(new[number])
                    hunk['lines'].append({'kind': 'add', 'old_line': None,
                        'new_line': number+1, 'text': text, 'ending': ending})
                    additions += 1
        hunks.append(hunk)
    preview = {'file_path': path, 'status': 'available', 'reason': None,
               'old_blob_sha': blob_sha(original), 'new_blob_sha': blob_sha(updated),
               'issue_ids': sorted(set(issue_ids)), 'additions': additions,
               'deletions': deletions, 'hunks': hunks}
    if len(json.dumps(preview).encode()) > MAX_FILE_BYTES:
        return unavailable(path, 'preview_limit')
    return preview


def bounded_previews(files):
    size, result = 0, []
    for preview in files:
        needed = len(json.dumps(preview).encode())
        if size + needed > MAX_PREVIEW_BYTES:
            preview = unavailable(preview['file_path'], 'preview_limit')
        size += len(json.dumps(preview).encode())
        result.append(preview)
    return result
