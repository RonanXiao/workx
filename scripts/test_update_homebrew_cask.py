import tempfile
import unittest
from pathlib import Path

from update_homebrew_cask import update_cask


class UpdateCaskTest(unittest.TestCase):
    def test_create_and_migrate_standalone_desktop(self):
        with tempfile.TemporaryDirectory() as directory:
            cask = Path(directory) / "Casks" / "workx.rb"
            self.assertTrue(update_cask(cask, "1.2.3"))
            expected = cask.read_text()
            self.assertNotIn("depends_on formula:", expected)
            for dependency in ("workx", "ronanxiao/workx/workx"):
                cask.write_text(
                    expected.replace('version "1.2.3"', 'version "1.2.2"')
                    + f'  depends_on formula: "{dependency}"\n'
                )
                self.assertTrue(update_cask(cask, "1.2.3"))
                self.assertEqual(cask.read_text(), expected)
                self.assertFalse(update_cask(cask, "1.2.3"))
