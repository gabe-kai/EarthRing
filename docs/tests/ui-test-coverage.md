# UI Component Test Coverage

## Overview

This document tracks test coverage for UI components in the EarthRing web client.

## Test Coverage Status

### ✅ Fully Tested Components

#### Minimap (`minimap.js`)
- **Test File**: `client-web/src/ui/minimap.test.js`
- **Test Count**: 55+ tests
- **Coverage**: Comprehensive
- **Areas Covered**:
  - Initialization and setup
  - Zoom controls (full/local view)
  - Coordinate conversions and ring wrapping
  - Grid system with movement
  - Player-facing arrow calculation
  - Platform rendering (polygons and rectangles)
  - Drawing order (arrow/north on top)
  - Error handling
  - Component disposal

**See**: [minimap-test-coverage.md](./minimap-test-coverage.md) for detailed analysis

#### Player UI (`player-ui.js`)
- **Test File**: `client-web/src/ui/player-ui.test.js`
- **Test Count**: 15+ tests
- **Coverage**: Good
- **Areas Covered**:
  - Panel creation and embedding
  - Show/hide functionality
  - Profile loading with error handling
  - Position updates with camera movement
  - Form validation and submission
  - Close button functionality

#### Zones Toolbar (`zones-toolbar.js`)
- **Test File**: `client-web/src/ui/zones-toolbar.test.js`
- **Test Count**: 12+ tests
- **Coverage**: Good
- **Areas Covered**:
  - Toolbar initialization
  - Expand/collapse functionality
  - Grid visibility toggle
  - Zone type visibility toggles
  - All zones visibility toggle
  - Active floor controls (increment/decrement)
  - Button state updates

### ⚠️ Partially Tested Components

None currently.

### ❌ Untested Components

#### High Priority (Recommended for Testing)

**Zone UI (`zone-ui.js`)**
- **Complexity**: High
- **Critical Features**: Zone CRUD operations, drawing tools, area queries
- **Risk**: High (user-created content, complex geometry)
- **Recommended Tests**:
  - Zone creation (Rectangle, Circle, Polygon, Paintbrush)
  - Zone updates and deletion
  - Zone selection and info display
  - Area query functionality
  - Error handling for invalid geometry
  - Zone conflict resolution

#### Medium Priority

**Chunk UI (`chunk-ui.js`)**
- **Complexity**: Medium
- **Purpose**: Testing/debugging tool for chunk management
- **Recommended Tests**:
  - Chunk metadata loading
  - Chunk deletion
  - Chunk version queries
  - Error handling

**Zone Info Window (`zone-info-window.js`)**
- **Complexity**: Medium
- **Purpose**: Display zone information
- **Recommended Tests**:
  - Zone data display
  - Window show/hide
  - Data formatting

#### Low Priority

**Admin Modal (`admin-modal.js`)**
- **Complexity**: Low
- **Purpose**: Admin functionality
- **Note**: Lower priority unless admin features expand

**Bottom Toolbar (`bottom-toolbar.js`)**
- **Complexity**: Low
- **Purpose**: Simple toolbar
- **Note**: Simple component, low risk

**Console (`console.js`)**
- **Complexity**: Low
- **Purpose**: Console component
- **Note**: Simple display component

**Debug Info (`debug-info.js`)**
- **Complexity**: Low
- **Purpose**: Debug panel
- **Note**: Development tool, lower priority

**Info Box (`info-box.js`)**
- **Complexity**: Low
- **Purpose**: Info display component
- **Note**: Simple display component

## Test Organization

All UI tests follow a consistent structure:

```javascript
describe('ComponentName', () => {
  describe('Initialization', () => {
    // Tests for component setup
  });
  
  describe('Core Functionality', () => {
    // Tests for main features
  });
  
  describe('Error Handling', () => {
    // Tests for error cases
  });
});
```

## Test Utilities

UI tests use:
- **Vitest**: Test framework
- **jsdom**: DOM environment
- **Test utilities**: `client-web/src/test-utils.js` (mocks, fixtures)

## Running UI Tests

```bash
cd client-web
npm test
```

Run specific test file:
```bash
npm test minimap.test.js
```

## Test Coverage Goals

### Current Status
- **Tested**: 3 components (Minimap, Player UI, Zones Toolbar)
- **Untested**: 8 components
- **Coverage**: ~27% of UI components

### Target Goals
1. **Short-term**: Add tests for `zone-ui.js` (high priority)
2. **Medium-term**: Add tests for medium-priority components
3. **Long-term**: Achieve 80%+ coverage for all UI components

## Best Practices

1. **Mock Dependencies**: Always mock external services (API calls, WebSocket, etc.)
2. **Test User Interactions**: Test button clicks, form submissions, keyboard input
3. **Test Error Cases**: Verify error handling and user feedback
4. **Test Edge Cases**: Boundary conditions, invalid input, missing data
5. **Keep Tests Fast**: Use mocks to avoid real network calls
6. **Test Accessibility**: Verify keyboard navigation, ARIA labels (future)

## Contributing

When adding tests for new UI components:

1. Create test file: `{component-name}.test.js`
2. Follow existing test structure
3. Mock all external dependencies
4. Test core functionality and error cases
5. Update this document with coverage status
6. Add entry to `docs/tests/README.md`

