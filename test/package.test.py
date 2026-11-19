#!/usr/bin/env python3
"""Packaging checks: synthetic rejection fixtures and a real clean-tree build."""
from pathlib import Path
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import warnings
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('verify_package', ROOT / 'scripts/verify-package.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agent-model-package-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.package = self.directory / 'fixture.vsix'
        self.metadata = json.loads((ROOT / 'package.json').read_text())

    def fixture(self, mutate=None):
        entries = {destination: (ROOT / source).read_bytes()
                   for source, destination in verifier.ASSETS.items()}
        ns = 'http://schemas.microsoft.com/developer/vsx-schema/2011'
        manifest = ET.Element('PackageManifest', xmlns=ns, Version='2.0.0')
        metadata = ET.SubElement(manifest, 'Metadata')
        ET.SubElement(metadata, 'Identity', Id=self.metadata['name'],
                      Version=self.metadata['version'], Publisher=self.metadata['publisher'])
        ET.SubElement(metadata, 'DisplayName').text = self.metadata['displayName']
        properties = ET.SubElement(metadata, 'Properties')
        ET.SubElement(properties, 'Property', Id='Microsoft.VisualStudio.Code.Engine',
                      Value=self.metadata['engines']['vscode'])
        assets = ET.SubElement(manifest, 'Assets')
        for asset_type, source in (
            ('Microsoft.VisualStudio.Code.Manifest', 'package.json'),
            ('Microsoft.VisualStudio.Services.Content.Details', 'README.md'),
            ('Microsoft.VisualStudio.Services.Content.License', 'LICENSE'),
            ('Microsoft.VisualStudio.Services.Content.Changelog', 'CHANGELOG.md'),
        ):
            ET.SubElement(assets, 'Asset', Type=asset_type, Path=verifier.ASSETS[source])
        entries['extension.vsixmanifest'] = ET.tostring(manifest)
        entries['[Content_Types].xml'] = b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
        if mutate:
            mutate(entries)
        with zipfile.ZipFile(self.package, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, value in entries.items():
                archive.writestr(name, value)

    def test_exact_candidate_fixture_passes(self):
        self.fixture()
        verifier.verify_package(self.package)

    def test_planning_file_in_archive_is_rejected(self):
        self.fixture(lambda entries: entries.update({'extension/.vscode/findings.md': b'fixture'}))
        with self.assertRaisesRegex(AssertionError, 'Unexpected='):
            verifier.verify_package(self.package)

    def test_stale_runtime_bytes_are_rejected(self):
        self.fixture(lambda entries: entries.update({'extension/extension.cjs': b'stale runtime'}))
        with self.assertRaisesRegex(AssertionError, 'extension.cjs'):
            verifier.verify_package(self.package)

    def test_changed_identity_is_rejected(self):
        def mutate(entries):
            metadata = json.loads(entries['extension/package.json'])
            metadata['publisher'] = 'fixture-other-publisher'
            entries['extension/package.json'] = json.dumps(metadata).encode()
        self.fixture(mutate)
        with self.assertRaisesRegex(AssertionError, 'publisher'):
            verifier.verify_package(self.package)

    def test_missing_manifest_asset_is_rejected(self):
        def mutate(entries):
            manifest = ET.fromstring(entries['extension.vsixmanifest'])
            assets = manifest.find('{*}Assets')
            assets.remove(list(assets)[-1])
            entries['extension.vsixmanifest'] = ET.tostring(manifest)
        self.fixture(mutate)
        with self.assertRaisesRegex(AssertionError, 'Changelog'):
            verifier.verify_package(self.package)

    def test_invalid_engine_is_rejected(self):
        def mutate(entries):
            manifest = ET.fromstring(entries['extension.vsixmanifest'])
            manifest.find('.//{*}Property').set('Value', '^1.0.0')
            entries['extension.vsixmanifest'] = ET.tostring(manifest)
        self.fixture(mutate)
        with self.assertRaisesRegex(AssertionError, 'Engine mismatch'):
            verifier.verify_package(self.package)

    def test_duplicate_zip_entry_is_rejected(self):
        self.fixture()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.package, 'a') as archive:
                archive.writestr('extension/package.json', b'{}')
        with self.assertRaisesRegex(AssertionError, 'duplicate entries=True'):
            verifier.verify_package(self.package)

    def test_corrupt_crc_is_rejected(self):
        self.fixture()
        with zipfile.ZipFile(self.package) as archive:
            contents = {name: archive.read(name) for name in archive.namelist()}
        with zipfile.ZipFile(self.package, 'w', zipfile.ZIP_STORED) as archive:
            for name, data in contents.items():
                archive.writestr(name, data)
        data = self.package.read_bytes()
        needle = contents['extension/extension.cjs']
        offset = data.index(needle)
        self.package.write_bytes(data[:offset] + bytes([data[offset] ^ 1]) + data[offset + 1:])
        with self.assertRaisesRegex(AssertionError, 'Corrupt ZIP entry: extension/extension.cjs'):
            verifier.verify_package(self.package)

    def test_oversized_entry_is_rejected(self):
        self.fixture(lambda entries: entries.update({
            'extension/extension.cjs': b'x' * (verifier.MAX_ENTRY_BYTES + 1)}))
        with self.assertRaisesRegex(AssertionError, 'Oversized ZIP entry'):
            verifier.verify_package(self.package)

    def test_xml_doctype_is_rejected(self):
        self.fixture(lambda entries: entries.update({
            '[Content_Types].xml': b'<!DOCTYPE Types><Types/>'}))
        with self.assertRaisesRegex(AssertionError, 'XML declarations'):
            verifier.verify_package(self.package)

    def test_duplicate_manifest_asset_is_rejected(self):
        def mutate(entries):
            manifest = ET.fromstring(entries['extension.vsixmanifest'])
            assets = manifest.find('{*}Assets')
            ET.SubElement(assets, '{http://schemas.microsoft.com/developer/vsx-schema/2011}Asset',
                          **dict(list(assets)[-1].attrib))
            entries['extension.vsixmanifest'] = ET.tostring(manifest)
        self.fixture(mutate)
        with self.assertRaisesRegex(AssertionError, 'Duplicate manifest asset'):
            verifier.verify_package(self.package)

    def test_lockfile_matches_development_tools(self):
        lock = json.loads((ROOT / 'package-lock.json').read_text())
        self.assertEqual(lock['packages']['']['devDependencies'], self.metadata['devDependencies'])
        self.assertEqual(lock['packages']['']['engines'], self.metadata['engines'])
        self.assertEqual(lock['packages']['node_modules/@vscode/vsce']['version'],
                         self.metadata['devDependencies']['@vscode/vsce'])
        self.assertNotIn('dependencies', self.metadata)

    def test_real_packer_creates_dist_and_excludes_development(self):
        sandbox = self.directory / 'clean-copy'
        sandbox.mkdir()
        for name in verifier.ASSETS:
            shutil.copy2(ROOT / name, sandbox / name)
        # Seed harmless sentinels for files which must never be published.
        for name in ('.vscode/findings.md', '.planning/history.md', 'test/fixture.cjs',
                     'scripts/fixture.py', 'DEVELOPMENT.md', 'PUBLISHING.md', 'old.vsix'):
            target = sandbox / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('synthetic excluded fixture')
        env = dict(os.environ)
        env['PATH'] = str(ROOT / 'node_modules/.bin') + os.pathsep + env.get('PATH', '')
        self.assertFalse((sandbox / 'dist').exists())
        result = subprocess.run(['npm', 'run', 'package:marketplace'], cwd=sandbox,
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        package = sandbox / 'dist' / f"{self.metadata['name']}-{self.metadata['version']}-marketplace.vsix"
        verifier.verify_package(package)
        self.assertEqual(list(sandbox.glob('*.vsix')), [sandbox / 'old.vsix'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
