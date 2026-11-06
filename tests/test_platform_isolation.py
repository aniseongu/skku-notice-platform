from pathlib import Path


def test_legacy_scheduled_workflows_are_not_installed():
    workflows = Path('.github/workflows')
    assert not (workflows / 'notice-and-pages.yml').exists()
    assert not (workflows / 'notice-relay.yml').exists()
