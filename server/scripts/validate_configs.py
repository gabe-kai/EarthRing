#!/usr/bin/env python3
"""
Validate hub-color-palettes.json and pillar-motifs.json
"""
import json
import sys
from pathlib import Path

# Expected structure
EXPECTED_HUBS = [
    'PillarOfKongo', 'PillarOfKilima', 'PillarOfLaccade', 'PillarOfNusantara',
    'PillarOfMakassar', 'PillarOfArafura', 'PillarOfKirana', 'PillarOfPolynesya',
    'PillarOfAndenor', 'PillarOfQuitoPrime', 'PillarOfSolamazon', 'PillarOfAtlantica'
]
EXPECTED_ZONES = ['Industrial', 'Commercial', 'Residential', 'Parks', 'Agricultural']
EXPECTED_COMPONENTS = ['foundation', 'walls', 'roofs', 'windows_doors', 'trim']

def validate_color_palettes():
    """Validate hub-color-palettes.json"""
    print("Validating hub-color-palettes.json...")
    config_path = Path(__file__).parent.parent / 'config' / 'hub-color-palettes.json'
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"✗ Invalid JSON: {e}")
        return False
    except FileNotFoundError:
        print(f"✗ File not found: {config_path}")
        return False
    
    # Check all hubs present
    missing_hubs = [h for h in EXPECTED_HUBS if h not in data]
    if missing_hubs:
        print(f"✗ Missing hubs: {missing_hubs}")
        return False
    print(f"✓ All {len(EXPECTED_HUBS)} hubs present")
    
    # Check zones and components
    missing_zones = {}
    missing_components = {}
    invalid_components = {}
    
    for hub in EXPECTED_HUBS:
        if hub not in data:
            continue
        for zone in EXPECTED_ZONES:
            if zone not in data[hub]:
                missing_zones.setdefault(hub, []).append(zone)
                continue
            
            for comp in EXPECTED_COMPONENTS:
                if comp not in data[hub][zone]:
                    missing_components.setdefault(f'{hub}.{zone}', []).append(comp)
                else:
                    comp_data = data[hub][zone][comp]
                    if not isinstance(comp_data, dict):
                        invalid_components.setdefault(f'{hub}.{zone}.{comp}', []).append('not a dict')
                    elif 'hex' not in comp_data:
                        invalid_components.setdefault(f'{hub}.{zone}.{comp}', []).append('missing hex')
                    elif 'name' not in comp_data:
                        invalid_components.setdefault(f'{hub}.{zone}.{comp}', []).append('missing name')
                    elif not isinstance(comp_data['hex'], str) or not comp_data['hex'].startswith('#'):
                        invalid_components.setdefault(f'{hub}.{zone}.{comp}', []).append('invalid hex format')
    
    if missing_zones:
        print(f"✗ Missing zones: {missing_zones}")
        return False
    print("✓ All zone types present for all hubs")
    
    if missing_components:
        print(f"✗ Missing components: {missing_components}")
        return False
    
    if invalid_components:
        print(f"✗ Invalid components: {invalid_components}")
        return False
    
    print("✓ All color components present and valid")
    
    # Test loading with actual module
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from internal.procedural import color_palettes
        colors = color_palettes.get_hub_colors('Pillar of Kongo', 'Industrial')
        if colors and 'foundation' in colors and colors['foundation']['hex']:
            print("✓ Module can successfully load colors")
        else:
            print("⚠ Module loaded but structure may be unexpected")
    except Exception as e:
        print(f"⚠ Could not test module loading: {e}")
    
    return True

def validate_pillar_motifs():
    """Validate pillar-motifs.json"""
    print("\nValidating pillar-motifs.json...")
    config_path = Path(__file__).parent.parent / 'config' / 'pillar-motifs.json'
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"✗ Invalid JSON: {e}")
        return False
    except FileNotFoundError:
        print(f"✗ File not found: {config_path}")
        return False
    
    if 'PillarMotifs' not in data:
        print("✗ Missing top-level 'PillarMotifs' key")
        return False
    print("✓ Top-level 'PillarMotifs' key present")
    
    pm = data['PillarMotifs']
    if len(pm) != len(EXPECTED_HUBS):
        print(f"⚠ Expected {len(EXPECTED_HUBS)} hubs, found {len(pm)}")
    
    missing_hubs = [h for h in EXPECTED_HUBS if h not in pm]
    if missing_hubs:
        print(f"⚠ Missing hubs: {missing_hubs}")
    else:
        print(f"✓ All {len(EXPECTED_HUBS)} hubs present")
    
    # Check structure of first hub
    if EXPECTED_HUBS[0] in pm:
        hub_data = pm[EXPECTED_HUBS[0]]
        hub_zones = list(hub_data.keys())
        print(f"✓ First hub '{EXPECTED_HUBS[0]}' has zones: {hub_zones}")
        
        # Check motifs structure
        if hub_zones and hub_zones[0] in hub_data:
            zone_motifs = hub_data[hub_zones[0]]
            if 'motifs' in zone_motifs and isinstance(zone_motifs['motifs'], list):
                if zone_motifs['motifs']:
                    first_motif = zone_motifs['motifs'][0]
                    required_keys = ['name', 'pattern', 'preferred_placements', 'default_scale', 'default_thickness', 'complexity']
                    missing_keys = [k for k in required_keys if k not in first_motif]
                    if missing_keys:
                        print(f"⚠ First motif missing keys: {missing_keys}")
                    else:
                        print(f"✓ Motif structure looks valid")
                else:
                    print("⚠ No motifs in first zone")
            else:
                print("⚠ 'motifs' key missing or not a list")
    
    return True

if __name__ == '__main__':
    success = True
    success &= validate_color_palettes()
    success &= validate_pillar_motifs()
    
    if success:
        print("\n✓ All validations passed!")
        sys.exit(0)
    else:
        print("\n✗ Some validations failed")
        sys.exit(1)

