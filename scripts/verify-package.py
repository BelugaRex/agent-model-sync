#!/usr/bin/env python3
"""Inspect the locally built Marketplace candidate without installing it."""
from pathlib import Path
import argparse
import json
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {
    'package.json': 'extension/package.json',
    'extension.cjs': 'extension/extension.cjs',
    'sync-core.cjs': 'extension/sync-core.cjs',
    'README.md': 'extension/readme.md',
    'LICENSE': 'extension/LICENSE.txt',
    'CHANGELOG.md': 'extension/changelog.md',
}
MAX_ENTRY_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024


def parse_xml(data):
    upper = data.upper()
    assert b'<!DOCTYPE' not in upper and b'<!ENTITY' not in upper, 'XML declarations are not allowed'
    return ET.fromstring(data)


def verify_package(package_path):
    metadata = json.loads((ROOT / 'package.json').read_text())
    assert set(metadata['files']) == set(ASSETS) - {'package.json'}, 'Unexpected source allowlist'
    expected = {'extension.vsixmanifest', '[Content_Types].xml'} | set(ASSETS.values())
    with zipfile.ZipFile(package_path) as archive:
        entries = archive.namelist()
        assert len(entries) == len(expected) and set(entries) == expected, (
            f'Unexpected={set(entries) - expected}, missing={expected - set(entries)}; duplicate entries={len(entries) != len(set(entries))}')
        infos = archive.infolist()
        assert all(info.file_size <= MAX_ENTRY_BYTES for info in infos), 'Oversized ZIP entry'
        assert sum(info.file_size for info in infos) <= MAX_TOTAL_BYTES, 'Oversized ZIP contents'
        corrupt = archive.testzip()
        assert corrupt is None, f'Corrupt ZIP entry: {corrupt}'
        packed_metadata = json.loads(archive.read('extension/package.json'))
        differing = {key for key in set(metadata) | set(packed_metadata)
                     if metadata.get(key) != packed_metadata.get(key)}
        assert not differing, f'Packaged manifest fields differ: {sorted(differing)}'
        for name, packed_path in ASSETS.items():
            if name != 'package.json':
                assert archive.read(packed_path) == (ROOT / name).read_bytes(), name
        ns = {'v': 'http://schemas.microsoft.com/developer/vsx-schema/2011'}
        manifest = parse_xml(archive.read('extension.vsixmanifest'))
        identity = manifest.find('v:Metadata/v:Identity', ns)
        assert identity is not None, 'Missing identity'
        for key, value in (('Id', metadata['name']), ('Version', metadata['version']),
                           ('Publisher', metadata['publisher'])):
            assert identity.attrib[key] == value, key
        display_name = manifest.find('v:Metadata/v:DisplayName', ns)
        assert display_name is not None and display_name.text == metadata['displayName'], 'Display name mismatch'
        asset_entries = manifest.findall('v:Assets/v:Asset', ns)
        manifest_assets = {asset.attrib['Type']: asset.attrib['Path'] for asset in asset_entries}
        assert len(manifest_assets) == len(asset_entries), 'Duplicate manifest asset types'
        assert set(manifest_assets.values()) <= expected, 'Manifest references missing assets'
        required_assets = {
            'Microsoft.VisualStudio.Code.Manifest': ASSETS['package.json'],
            'Microsoft.VisualStudio.Services.Content.Details': ASSETS['README.md'],
            'Microsoft.VisualStudio.Services.Content.License': ASSETS['LICENSE'],
            'Microsoft.VisualStudio.Services.Content.Changelog': ASSETS['CHANGELOG.md'],
        }
        for asset_type, asset_path in required_assets.items():
            assert manifest_assets.get(asset_type) == asset_path, f'Missing or incorrect asset: {asset_type}'
        properties = {prop.attrib['Id']: prop.attrib['Value'] for prop in
                      manifest.findall('v:Metadata/v:Properties/v:Property', ns)}
        assert properties.get('Microsoft.VisualStudio.Code.Engine') == metadata['engines']['vscode'], 'Engine mismatch'
        parse_xml(archive.read('[Content_Types].xml'))
    print(f'PASS: {package_path.name}: {len(expected)} exact entries, ZIP CRC/XML/identity and source bytes; no development or planning files.')


if __name__ == '__main__':
    metadata = json.loads((ROOT / 'package.json').read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', nargs='?', type=Path,
                        default=ROOT / 'dist' / f"{metadata['name']}-{metadata['version']}-marketplace.vsix")
    verify_package(parser.parse_args().package)
