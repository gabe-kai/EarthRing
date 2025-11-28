# Test Documentation

This directory contains all test-related documentation for the EarthRing project.

## Organization

Test documentation is separated from design documentation to keep each focused:
- **Design docs** (`docs/`): Architecture, APIs, game mechanics (the "what" and "why")
- **Test docs** (`docs/tests/`): Test strategies, coverage analysis, test organization (the "how")

## Contents

### Test Coverage Analysis
- `minimap-test-coverage.md` - Minimap component test coverage and analysis
- `zone-system-test-coverage.md` - Zone system test coverage and analysis
- `testing-gap-analysis.md` - Overall testing gaps and recommendations

### Testing Strategies
- `integration-testing.md` - Integration testing plans and strategies

## Adding New Test Documentation

When adding test documentation for a new component:

1. **Create coverage document**: `{component-name}-test-coverage.md`
   - Document what's tested
   - Document what's missing
   - Provide recommendations

2. **Update this README**: Add entry to Contents section

3. **Link from design doc**: Add reference in the relevant design document (e.g., `06-client-architecture.md`)

## Test File Locations

- **Go tests**: `server/internal/{package}/{package}_test.go`
- **Python tests**: `server/tests/test_*.py`
- **JavaScript tests**: `client-web/src/{module}/{module}.test.js`

## Running Tests

See [DEVELOPER_WORKFLOW.md](../DEVELOPER_WORKFLOW.md#testing-strategy) for test execution instructions.

