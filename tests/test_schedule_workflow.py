"""Check the actual workflow command for manual and scheduled dispatches."""

import os
import subprocess
from pathlib import Path

import yaml


def test_collection_mode_for_schedule_and_dispatch(tmp_path):
    workflow = yaml.safe_load(Path('.github/workflows/notice-and-pages.yml').read_text())
    step = next(s for s in workflow['jobs']['notice']['steps'] if s.get('id') == 'run_notice')
    assert step['env']['AUTOMATIC_RUN'] == '${{ inputs.automatic }}'
    executable = tmp_path / 'uv'
    executable.write_text('#!/bin/sh\nprintf "%s\\n" "$*"\n')
    executable.chmod(0o755)
    env = {**os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}'}
    for event, external, expected in (
        ('schedule', '', 'run skku-notice --export site --external-if-due'),
        ('workflow_dispatch', 'true', 'run skku-notice --export site --external-if-due'),
        ('workflow_dispatch', 'false', 'run skku-notice --export site'),
        ('workflow_dispatch', '', 'run skku-notice --export site'),
    ):
        output = subprocess.check_output(
            ['bash', '-c', step['run']],
            env={**env, 'GITHUB_EVENT_NAME': event, 'AUTOMATIC_RUN': external},
            text=True,
        )
        assert output.strip() == expected


def test_relay_requests_collection_or_rearms_when_collection_is_active(tmp_path):
    workflow = yaml.safe_load(Path('.github/workflows/notice-and-pages.yml').read_text())
    relay = yaml.safe_load(Path('.github/workflows/notice-relay.yml').read_text())
    assert workflow['concurrency']['group'] == 'notice-crawl'
    assert workflow['concurrency']['queue'] == 'max'
    assert relay['concurrency']['group'] == 'notice-relay'
    assert workflow['jobs']['gate']['outputs']['go'] == '${{ steps.check.outputs.go }}'
    chain = workflow['jobs']['chain']
    assert chain['permissions'] == {'actions': 'write'}
    assert 'always()' in chain['if']
    assert 'sleep' not in chain['steps'][0]['run']
    assert relay['jobs']['relay']['permissions'] == {'actions': 'write'}
    step = relay['jobs']['relay']['steps'][0]
    (tmp_path / 'sleep').write_text('#!/bin/sh\nexit 0\n')
    gh = tmp_path / 'gh'
    gh.write_text(
        '#!/bin/sh\n'
        'if [ "$1 $2" = "run list" ]; then printf "%s\\n" "$OTHER_RUNS"; '
        'else printf "%s\\n" "$*" >> "$RELAY_TEST_LOG"; fi\n'
    )
    for executable in (tmp_path / 'sleep', gh):
        executable.chmod(0o755)
    log = tmp_path / 'calls'
    env = {
        **os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}', 'RUN_ID': '123',
        'GITHUB_REF_NAME': 'main', 'RELAY_TEST_LOG': str(log),
    }
    for count in ('0', '1'):
        subprocess.run(
            ['bash', '-e', '-c', step['run']], env={**env, 'OTHER_RUNS': count},
            check=True, capture_output=True, text=True,
        )
    assert log.read_text().splitlines() == [
        'workflow run notice-and-pages.yml --ref main -f automatic=true',
        'workflow run notice-relay.yml --ref main',
    ]



def test_collection_always_arms_a_separate_relay(tmp_path):
    workflow = yaml.safe_load(Path('.github/workflows/notice-and-pages.yml').read_text())
    relay = yaml.safe_load(Path('.github/workflows/notice-relay.yml').read_text())
    assert relay['concurrency']['cancel-in-progress'] is False
    assert relay['concurrency'].get('queue', 'single') == 'single'
    script = workflow['jobs']['chain']['steps'][0]['run']
    gh = tmp_path / 'gh'
    gh.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$RELAY_TEST_LOG"\n')
    gh.chmod(0o755)
    log = tmp_path / 'calls'
    env = {
        **os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}',
        'GITHUB_REF_NAME': 'main', 'RELAY_TEST_LOG': str(log),
    }
    subprocess.run(['bash', '-e', '-c', script], env=env, check=True, capture_output=True, text=True)
    assert log.read_text().splitlines() == ['workflow run notice-relay.yml --ref main']
