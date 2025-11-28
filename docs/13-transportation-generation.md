# Transportation Generation Algorithm Specification

**Status**: 📋 **DESIGN SPECIFICATION** - This document specifies the planned organic transportation generation system.

**Related Documentation**:
- [Zone System](09-zone-system.md) - Zones that transportation connects
- [NPC AI and Pathfinding](12-npc-ai-pathfinding.md) - NPCs that generate traffic patterns
- [Game Mechanics](10-game-mechanics.md) - Transportation used for racing and NPC movement
- [Database Schema](03-database-schema.md) - Traffic data storage
- [Implementation Phases](../implementation-phases.md) - Feature implementation roadmap

## Table of Contents

- [Overview](#overview)
- [Traffic Data Collection](#traffic-data-collection)
  - [Path Recording](#path-recording)
  - [Traffic Data Storage](#traffic-data-storage)
  - [Data Aggregation](#data-aggregation)
- [Traffic Density Calculation](#traffic-density-calculation)
  - [Density Formulas](#density-formulas)
  - [Time Weighting](#time-weighting)
  - [Segment-Based Analysis](#segment-based-analysis)
  - [Spatial Aggregation](#spatial-aggregation)
- [Infrastructure Generation Thresholds](#infrastructure-generation-thresholds)
  - [Threshold Values](#threshold-values)
  - [Distance Considerations](#distance-considerations)
  - [Capacity Calculations](#capacity-calculations)
  - [Generation Rules](#generation-rules)
- [Infrastructure Upgrade/Downgrade System](#infrastructure-upgradedowngrade-system)
  - [Upgrade Thresholds](#upgrade-thresholds)
  - [Downgrade Thresholds](#downgrade-thresholds)
  - [Hysteresis](#hysteresis)
  - [Upgrade/Downgrade Process](#upgradedowngrade-process)
- [Lane Widening Algorithm](#lane-widening-algorithm)
  - [Widening Thresholds](#widening-thresholds)
  - [Widening Process](#widening-process)
  - [Maximum Width Limits](#maximum-width-limits)
  - [Multi-Lane Generation](#multi-lane-generation)
- [Network Connectivity Algorithms](#network-connectivity-algorithms)
  - [Network Graph Construction](#network-graph-construction)
  - [Connectivity Analysis](#connectivity-analysis)
  - [Intersection Handling](#intersection-handling)
  - [Maglev Integration](#maglev-integration)
- [Transportation Hierarchy](#transportation-hierarchy)
  - [Transportation Types](#transportation-types)
  - [Hierarchy Rules](#hierarchy-rules)
  - [Mode Transitions](#mode-transitions)
- [Performance Optimization](#performance-optimization)
  - [Incremental Updates](#incremental-updates)
  - [Spatial Indexing](#spatial-indexing)
  - [Batch Processing](#batch-processing)
  - [Caching Strategies](#caching-strategies)
- [Traffic Pattern Stability](#traffic-pattern-stability)
  - [In-Game Week Requirement](#in-game-week-requirement)
  - [Pattern Recognition](#pattern-recognition)
  - [Temporary Event Filtering](#temporary-event-filtering)
- [Manual Infrastructure Placement](#manual-infrastructure-placement)
  - [Infrastructure Manager Role](#infrastructure-manager-role)
  - [Manual Placement Rules](#manual-placement-rules)
  - [Override System](#override-system)
- [Implementation Phases](#implementation-phases)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

This document specifies the implementation details for organic transportation generation in EarthRing. Transportation infrastructure is not manually placed by players (except for Infrastructure Managers), but instead grows organically based on NPC traffic patterns. The system analyzes where NPCs frequently travel and generates appropriate transportation infrastructure along those paths.

**Key Requirements:**
- **Organic Growth**: Infrastructure generates based on NPC traffic patterns
- **Dynamic Adaptation**: Infrastructure upgrades/downgrades based on traffic
- **Network Connectivity**: Maintains connected transportation network
- **Performance**: Efficient updates and spatial queries
- **Stability**: Requires sustained traffic patterns (in-game week) before changes

**Design Philosophy:**
- Infrastructure follows NPCs, not the other way around
- Natural, organic growth patterns
- Prevents temporary events from causing infrastructure changes
- Smooth transitions between infrastructure types

## Traffic Data Collection

### Path Recording

**NPC Path Tracking**:
- Record NPC movement paths as they travel
- Store path segments with timestamps
- Track both abstract mass and detailed NPC paths
- Aggregate paths for traffic analysis

**Implementation**:
```javascript
class TrafficPathRecorder {
    recordPath(npc, path) {
        const pathSegments = this.segmentizePath(path);
        
        for (const segment of pathSegments) {
            this.storePathSegment({
                npcId: npc.id,
                segment: segment,
                timestamp: Date.now(),
                npcType: npc.type,
                isAbstract: npc.isAbstract
            });
        }
    }
    
    segmentizePath(path) {
        // Break path into segments (e.g., 10m segments)
        const segments = [];
        const segmentLength = 10; // meters
        
        for (let i = 0; i < path.length - 1; i++) {
            const start = path[i];
            const end = path[i + 1];
            const distance = start.distanceTo(end);
            
            // Split long segments
            const numSubSegments = Math.ceil(distance / segmentLength);
            for (let j = 0; j < numSubSegments; j++) {
                const t = j / numSubSegments;
                const segmentStart = start.clone().lerp(end, t);
                const segmentEnd = start.clone().lerp(end, (j + 1) / numSubSegments);
                
                segments.push({
                    start: segmentStart,
                    end: segmentEnd,
                    length: segmentStart.distanceTo(segmentEnd)
                });
            }
        }
        
        return segments;
    }
}
```

**Path Storage**:
- Store in `npc_traffic` database table
- Include segment geometry (PostGIS LINESTRING)
- Timestamp for time-based filtering
- NPC type and abstract/detailed flag

### Traffic Data Storage

**Database Schema**: See [Database Schema Documentation](03-database-schema.md) for complete schema details:
```sql
CREATE TABLE npc_traffic (
    id SERIAL PRIMARY KEY,
    segment GEOMETRY(LINESTRING, 0) NOT NULL,
    npc_id INTEGER,
    npc_type VARCHAR(50),
    is_abstract BOOLEAN DEFAULT TRUE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    frequency INTEGER DEFAULT 1 -- For aggregate paths
);

CREATE INDEX idx_npc_traffic_segment ON npc_traffic USING GIST(segment);
CREATE INDEX idx_npc_traffic_timestamp ON npc_traffic(timestamp);
```

**Storage Strategy**:
- Store individual path segments
- Aggregate abstract mass paths by frequency
- Index by geometry for spatial queries
- Index by timestamp for time-based queries

### Data Aggregation

**Aggregation Process**:
- Aggregate paths by segment
- Weight by frequency and recency
- Combine abstract and detailed NPC paths
- Generate traffic density map

**Implementation**:
```javascript
class TrafficDataAggregator {
    aggregateTrafficData(timeWindow) {
        // Query traffic data within time window
        const trafficData = this.queryTrafficData(timeWindow);
        
        // Aggregate by segment
        const segmentMap = new Map();
        
        for (const record of trafficData) {
            const segmentKey = this.getSegmentKey(record.segment);
            
            if (!segmentMap.has(segmentKey)) {
                segmentMap.set(segmentKey, {
                    segment: record.segment,
                    totalTraffic: 0,
                    recentTraffic: 0,
                    npcTypes: new Map()
                });
            }
            
            const segmentData = segmentMap.get(segmentKey);
            segmentData.totalTraffic += record.frequency;
            
            // Weight recent traffic more heavily
            const age = Date.now() - record.timestamp;
            const recencyWeight = this.calculateRecencyWeight(age, timeWindow);
            segmentData.recentTraffic += record.frequency * recencyWeight;
            
            // Track NPC types
            const typeCount = segmentData.npcTypes.get(record.npc_type) || 0;
            segmentData.npcTypes.set(record.npc_type, typeCount + record.frequency);
        }
        
        return Array.from(segmentMap.values());
    }
    
    calculateRecencyWeight(age, timeWindow) {
        // Linear decay: more recent = higher weight
        const normalizedAge = Math.min(age / timeWindow, 1.0);
        return 1.0 - normalizedAge;
    }
}
```

## Traffic Density Calculation

### Density Formulas

**Traffic Density Calculation**:
- Density = Total traffic / Segment length / Time window
- Units: NPCs per meter per hour (or similar)

**Implementation**:
```javascript
class TrafficDensityCalculator {
    calculateDensity(segmentData, segmentLength, timeWindow) {
        // Basic density: traffic count / length / time
        const trafficCount = segmentData.totalTraffic;
        const hours = timeWindow / (1000 * 60 * 60); // Convert ms to hours
        
        const density = trafficCount / segmentLength / hours;
        
        // Weighted density (recent traffic weighted more)
        const recentDensity = segmentData.recentTraffic / segmentLength / hours;
        
        return {
            averageDensity: density,
            recentDensity: recentDensity,
            totalTraffic: trafficCount
        };
    }
    
    calculateSegmentDensity(segment, timeWindow) {
        const segmentLength = this.calculateSegmentLength(segment);
        const trafficData = this.aggregateTrafficData(segment, timeWindow);
        
        return this.calculateDensity(trafficData, segmentLength, timeWindow);
    }
}
```

**Density Metrics**:
- **Average Density**: Total traffic over time window
- **Recent Density**: Weighted by recency
- **Peak Density**: Maximum traffic in any time period
- **Sustained Density**: Traffic maintained over multiple periods

### Time Weighting

**Recency Weighting**:
- Recent traffic weighted more heavily than old traffic
- Exponential decay for older data
- Prevents stale data from affecting decisions

**Implementation**:
```javascript
function calculateTimeWeight(timestamp, currentTime, timeWindow) {
    const age = currentTime - timestamp;
    const normalizedAge = age / timeWindow;
    
    // Exponential decay: e^(-λt)
    const decayRate = 2.0; // Adjust for decay speed
    return Math.exp(-decayRate * normalizedAge);
}
```

**Time Window**:
- **Analysis Window**: In-game week (7 days) for infrastructure changes
- **Short Window**: 1 day for density calculations
- **Long Window**: 1 month for trend analysis

### Segment-Based Analysis

**Segment Division**:
- Divide paths into segments (10m default)
- Analyze density per segment
- Aggregate segments for infrastructure generation
- Consider segment connectivity

**Implementation**:
```javascript
class SegmentAnalyzer {
    analyzeSegments(pathSegments, timeWindow) {
        const segmentAnalysis = new Map();
        
        for (const segment of pathSegments) {
            const density = this.calculateSegmentDensity(segment, timeWindow);
            const distance = this.calculateSegmentDistance(segment);
            
            segmentAnalysis.set(segment.id, {
                segment: segment,
                density: density,
                distance: distance,
                connectivity: this.analyzeConnectivity(segment)
            });
        }
        
        return segmentAnalysis;
    }
    
    aggregateSegments(segmentAnalysis, maxDistance) {
        // Group segments into corridors
        const corridors = [];
        const processed = new Set();
        
        for (const [segmentId, analysis] of segmentAnalysis) {
            if (processed.has(segmentId)) continue;
            
            const corridor = this.buildCorridor(segmentId, segmentAnalysis, maxDistance);
            corridors.push(corridor);
            
            for (const segId of corridor.segments) {
                processed.add(segId);
            }
        }
        
        return corridors;
    }
}
```

### Spatial Aggregation

**Spatial Clustering**:
- Group nearby segments into corridors
- Identify high-traffic routes
- Consider distance and direction
- Generate infrastructure for corridors

**Implementation**:
```javascript
class SpatialAggregator {
    clusterSegments(segments, maxDistance) {
        // Use DBSCAN or similar clustering algorithm
        const clusters = [];
        const visited = new Set();
        
        for (const segment of segments) {
            if (visited.has(segment.id)) continue;
            
            const cluster = this.buildCluster(segment, segments, maxDistance);
            clusters.push(cluster);
            
            for (const seg of cluster.segments) {
                visited.add(seg.id);
            }
        }
        
        return clusters;
    }
    
    buildCluster(seedSegment, allSegments, maxDistance) {
        const cluster = {
            segments: [seedSegment],
            center: seedSegment.center,
            totalDensity: seedSegment.density
        };
        
        // Find nearby segments
        for (const segment of allSegments) {
            if (segment.id === seedSegment.id) continue;
            
            const distance = seedSegment.center.distanceTo(segment.center);
            if (distance <= maxDistance) {
                cluster.segments.push(segment);
                cluster.totalDensity += segment.density;
            }
        }
        
        // Calculate average density
        cluster.averageDensity = cluster.totalDensity / cluster.segments.length;
        
        return cluster;
    }
}
```

## Infrastructure Generation Thresholds

### Threshold Values

**Traffic Density Thresholds** (NPCs per meter per hour):

| Infrastructure Type | Minimum Density | Typical Density | Maximum Distance |
|---------------------|----------------|-----------------|-------------------|
| Foot Traffic | 0 | 1-5 | Unlimited |
| Bike/Skate Lane (narrow) | 5 | 10-20 | 500m |
| Bike/Skate Lane (wide) | 20 | 30-50 | 500m |
| Conveyor Sidewalk | 50 | 100-200 | 1000m |
| Tram-Loop | 200 | 300-500 | 5000m |
| Road Lane (hub only) | N/A | N/A | Hub areas |

**Distance Thresholds**:
- **Short Distance**: < 500m
- **Medium Distance**: 500m - 2000m
- **Long Distance**: > 2000m (use maglev)

**Implementation**:
```javascript
const INFRASTRUCTURE_THRESHOLDS = {
    foot: {
        minDensity: 0,
        maxDensity: 5,
        maxDistance: Infinity
    },
    bikeSkateNarrow: {
        minDensity: 5,
        maxDensity: 20,
        maxDistance: 500
    },
    bikeSkateWide: {
        minDensity: 20,
        maxDensity: 50,
        maxDistance: 500
    },
    conveyor: {
        minDensity: 50,
        maxDensity: 200,
        maxDistance: 1000
    },
    tramLoop: {
        minDensity: 200,
        maxDensity: Infinity,
        maxDistance: 5000
    }
};

function determineInfrastructureType(density, distance) {
    if (density >= INFRASTRUCTURE_THRESHOLDS.tramLoop.minDensity && 
        distance <= INFRASTRUCTURE_THRESHOLDS.tramLoop.maxDistance) {
        return 'tram_loop';
    }
    
    if (density >= INFRASTRUCTURE_THRESHOLDS.conveyor.minDensity && 
        distance <= INFRASTRUCTURE_THRESHOLDS.conveyor.maxDistance) {
        return 'conveyor';
    }
    
    if (density >= INFRASTRUCTURE_THRESHOLDS.bikeSkateWide.minDensity && 
        distance <= INFRASTRUCTURE_THRESHOLDS.bikeSkateWide.maxDistance) {
        return 'bike_skate_wide';
    }
    
    if (density >= INFRASTRUCTURE_THRESHOLDS.bikeSkateNarrow.minDensity && 
        distance <= INFRASTRUCTURE_THRESHOLDS.bikeSkateNarrow.maxDistance) {
        return 'bike_skate_narrow';
    }
    
    return 'foot';
}
```

### Distance Considerations

**Distance Calculation**:
- Calculate distance along path (not straight-line)
- Consider route complexity
- Account for elevation changes
- Use actual travel distance

**Distance-Based Rules**:
- Short distances: Prefer conveyors, bike lanes
- Medium distances: Prefer tram-loops
- Long distances: Use maglev (not generated by traffic)

**Implementation**:
```javascript
function calculateRouteDistance(path) {
    let totalDistance = 0;
    
    for (let i = 0; i < path.length - 1; i++) {
        totalDistance += path[i].distanceTo(path[i + 1]);
    }
    
    return totalDistance;
}

function adjustThresholdsForDistance(distance, baseThresholds) {
    // Adjust thresholds based on distance
    // Longer distances require higher density to justify infrastructure
    
    if (distance > 2000) {
        // Very long distances: require very high density
        return {
            ...baseThresholds,
            minDensity: baseThresholds.minDensity * 1.5
        };
    }
    
    if (distance < 500) {
        // Short distances: lower threshold
        return {
            ...baseThresholds,
            minDensity: baseThresholds.minDensity * 0.8
        };
    }
    
    return baseThresholds;
}
```

### Capacity Calculations

**Infrastructure Capacity**:
- Each infrastructure type has capacity (NPCs per hour)
- Capacity determines when upgrade is needed
- Capacity based on width and type

**Capacity Values**:

| Infrastructure Type | Capacity (NPCs/hour) | Width (meters) |
|---------------------|---------------------|-----------------|
| Foot Traffic | 1000 | 2 |
| Bike/Skate Lane (narrow) | 500 | 2-3 |
| Bike/Skate Lane (wide) | 1000 | 4-5 |
| Conveyor Sidewalk | 2000 | 3-5 |
| Conveyor Sidewalk (wide) | 4000 | 6-8 |
| Tram-Loop | 5000 | 6-8 |
| Tram-Loop (wide) | 10000 | 10-12 |

**Implementation**:
```javascript
const INFRASTRUCTURE_CAPACITY = {
    foot: { base: 1000, perMeter: 500 },
    bike_skate_narrow: { base: 500, perMeter: 250 },
    bike_skate_wide: { base: 1000, perMeter: 250 },
    conveyor: { base: 2000, perMeter: 400 },
    conveyor_wide: { base: 4000, perMeter: 500 },
    tram_loop: { base: 5000, perMeter: 625 },
    tram_loop_wide: { base: 10000, perMeter: 833 }
};

function calculateCapacity(infrastructureType, width) {
    const capacity = INFRASTRUCTURE_CAPACITY[infrastructureType];
    return capacity.base + (width - capacity.baseWidth) * capacity.perMeter;
}

function isCapacityExceeded(infrastructure, trafficDensity) {
    const capacity = calculateCapacity(infrastructure.type, infrastructure.width);
    return trafficDensity > capacity * 0.9; // 90% threshold
}
```

### Generation Rules

**Generation Priority**:
1. Check if infrastructure already exists
2. Check traffic density threshold
3. Check distance requirements
4. Check network connectivity
5. Generate appropriate infrastructure

**Implementation**:
```javascript
class InfrastructureGenerator {
    generateInfrastructure(corridor, trafficData) {
        // Check if infrastructure already exists
        const existing = this.findExistingInfrastructure(corridor);
        if (existing) {
            // Check if upgrade needed
            return this.checkUpgrade(existing, trafficData);
        }
        
        // Calculate density and distance
        const density = this.calculateDensity(corridor, trafficData);
        const distance = this.calculateDistance(corridor);
        
        // Determine infrastructure type
        const infrastructureType = determineInfrastructureType(density, distance);
        
        if (infrastructureType === 'foot') {
            return null; // No infrastructure needed
        }
        
        // Generate infrastructure
        return this.createInfrastructure(corridor, infrastructureType);
    }
    
    createInfrastructure(corridor, type) {
        const infrastructure = {
            type: type,
            geometry: corridor.geometry,
            width: this.getDefaultWidth(type),
            capacity: this.calculateCapacity(type, this.getDefaultWidth(type)),
            created_at: Date.now()
        };
        
        // Connect to network
        this.connectToNetwork(infrastructure);
        
        return infrastructure;
    }
}
```

## Infrastructure Upgrade/Downgrade System

### Upgrade Thresholds

**Upgrade Conditions**:
- Traffic density exceeds current capacity (90% threshold)
- Traffic sustained at high level for in-game week
- Distance requirements met for upgraded type

**Upgrade Path**:
```
Foot → Bike/Skate (narrow) → Bike/Skate (wide) → Conveyor → Conveyor (wide) → Tram-Loop → Tram-Loop (wide)
```

**Implementation**:
```javascript
class InfrastructureUpgrader {
    checkUpgrade(infrastructure, trafficData) {
        const capacity = this.calculateCapacity(infrastructure.type, infrastructure.width);
        const trafficDensity = this.calculateTrafficDensity(infrastructure, trafficData);
        
        // Check if capacity exceeded
        if (trafficDensity > capacity * 0.9) {
            // Check if sustained (in-game week)
            if (this.isTrafficSustained(infrastructure, trafficData, 'week')) {
                return this.upgradeInfrastructure(infrastructure);
            }
        }
        
        // Check if can widen instead of upgrade
        if (this.canWiden(infrastructure)) {
            return this.widenInfrastructure(infrastructure);
        }
        
        return null;
    }
    
    upgradeInfrastructure(infrastructure) {
        const upgradePath = {
            'foot': 'bike_skate_narrow',
            'bike_skate_narrow': 'bike_skate_wide',
            'bike_skate_wide': 'conveyor',
            'conveyor': 'conveyor_wide',
            'conveyor_wide': 'tram_loop',
            'tram_loop': 'tram_loop_wide'
        };
        
        const newType = upgradePath[infrastructure.type];
        if (!newType) {
            return null; // Already at maximum
        }
        
        return {
            ...infrastructure,
            type: newType,
            width: this.getDefaultWidth(newType),
            capacity: this.calculateCapacity(newType, this.getDefaultWidth(newType))
        };
    }
}
```

### Downgrade Thresholds

**Downgrade Conditions**:
- Traffic density below threshold for current type
- Traffic sustained at low level for in-game week
- Infrastructure narrows first, then downgrades if traffic continues low

**Downgrade Path**:
```
Tram-Loop (wide) → Tram-Loop → Conveyor (wide) → Conveyor → Bike/Skate (wide) → Bike/Skate (narrow) → Foot
```

**Implementation**:
```javascript
class InfrastructureDowngrader {
    checkDowngrade(infrastructure, trafficData) {
        const threshold = this.getDowngradeThreshold(infrastructure.type);
        const trafficDensity = this.calculateTrafficDensity(infrastructure, trafficData);
        
        // Check if below threshold
        if (trafficDensity < threshold) {
            // Check if sustained (in-game week)
            if (this.isTrafficSustained(infrastructure, trafficData, 'week')) {
                // Try narrowing first
                if (this.canNarrow(infrastructure)) {
                    return this.narrowInfrastructure(infrastructure);
                } else {
                    return this.downgradeInfrastructure(infrastructure);
                }
            }
        }
        
        return null;
    }
    
    downgradeInfrastructure(infrastructure) {
        const downgradePath = {
            'tram_loop_wide': 'tram_loop',
            'tram_loop': 'conveyor_wide',
            'conveyor_wide': 'conveyor',
            'conveyor': 'bike_skate_wide',
            'bike_skate_wide': 'bike_skate_narrow',
            'bike_skate_narrow': 'foot'
        };
        
        const newType = downgradePath[infrastructure.type];
        if (!newType) {
            return null; // Already at minimum
        }
        
        if (newType === 'foot') {
            // Remove infrastructure
            return null;
        }
        
        return {
            ...infrastructure,
            type: newType,
            width: this.getDefaultWidth(newType),
            capacity: this.calculateCapacity(newType, this.getDefaultWidth(newType))
        };
    }
}
```

### Hysteresis

**Hysteresis System**:
- Prevents rapid oscillation between states
- Upgrade threshold higher than downgrade threshold
- Requires sustained change before switching

**Implementation**:
```javascript
const HYSTERESIS_FACTOR = 0.2; // 20% difference

function getUpgradeThreshold(baseType) {
    return INFRASTRUCTURE_THRESHOLDS[baseType].minDensity;
}

function getDowngradeThreshold(currentType) {
    const baseThreshold = INFRASTRUCTURE_THRESHOLDS[currentType].minDensity;
    return baseThreshold * (1 - HYSTERESIS_FACTOR); // Lower threshold for downgrade
}
```

### Upgrade/Downgrade Process

**Process Steps**:
1. Analyze traffic data over in-game week
2. Calculate average traffic density
3. Compare to thresholds (with hysteresis)
4. Determine if upgrade/downgrade needed
5. Generate new infrastructure
6. Remove old infrastructure
7. Update network connectivity

**Implementation**:
```javascript
class InfrastructureManager {
    updateInfrastructure(timeWindow) {
        // Analyze traffic over time window
        const trafficData = this.analyzeTraffic(timeWindow);
        
        // Check each infrastructure segment
        for (const infrastructure of this.getAllInfrastructure()) {
            // Check upgrade
            const upgrade = this.upgrader.checkUpgrade(infrastructure, trafficData);
            if (upgrade) {
                this.applyUpgrade(infrastructure, upgrade);
                continue;
            }
            
            // Check downgrade
            const downgrade = this.downgrader.checkDowngrade(infrastructure, trafficData);
            if (downgrade === null) {
                // Remove infrastructure
                this.removeInfrastructure(infrastructure);
            } else if (downgrade) {
                this.applyDowngrade(infrastructure, downgrade);
            }
        }
    }
    
    applyUpgrade(oldInfrastructure, newInfrastructure) {
        // Remove old
        this.removeInfrastructure(oldInfrastructure);
        
        // Add new
        this.addInfrastructure(newInfrastructure);
        
        // Update network
        this.updateNetworkConnectivity();
    }
}
```

## Lane Widening Algorithm

### Widening Thresholds

**Widening Conditions**:
- Traffic density exceeds 80% of current capacity
- Traffic sustained for in-game week
- Infrastructure not at maximum width

**Widening Increments**:
- Bike/Skate: 0.5m increments (max 5m)
- Conveyor: 1m increments (max 8m)
- Tram-Loop: 1m increments (max 12m)

**Implementation**:
```javascript
class LaneWidener {
    checkWidening(infrastructure, trafficData) {
        const capacity = this.calculateCapacity(infrastructure.type, infrastructure.width);
        const trafficDensity = this.calculateTrafficDensity(infrastructure, trafficData);
        
        // Check if approaching capacity
        if (trafficDensity > capacity * 0.8) {
            // Check if sustained
            if (this.isTrafficSustained(infrastructure, trafficData, 'week')) {
                // Check if can widen
                if (this.canWiden(infrastructure)) {
                    return this.calculateWidening(infrastructure);
                }
            }
        }
        
        return null;
    }
    
    canWiden(infrastructure) {
        const maxWidth = this.getMaxWidth(infrastructure.type);
        return infrastructure.width < maxWidth;
    }
    
    calculateWidening(infrastructure) {
        const increment = this.getWideningIncrement(infrastructure.type);
        const newWidth = Math.min(
            infrastructure.width + increment,
            this.getMaxWidth(infrastructure.type)
        );
        
        return {
            ...infrastructure,
            width: newWidth,
            capacity: this.calculateCapacity(infrastructure.type, newWidth)
        };
    }
    
    getWideningIncrement(type) {
        const increments = {
            'bike_skate_narrow': 0.5,
            'bike_skate_wide': 0.5,
            'conveyor': 1.0,
            'conveyor_wide': 1.0,
            'tram_loop': 1.0,
            'tram_loop_wide': 1.0
        };
        
        return increments[type] || 0.5;
    }
}
```

### Widening Process

**Process**:
1. Check traffic density
2. Verify sustained traffic
3. Calculate new width
4. Update infrastructure
5. Update capacity
6. Maintain network connectivity

### Maximum Width Limits

**Maximum Widths**:

| Infrastructure Type | Default Width | Maximum Width |
|---------------------|---------------|---------------|
| Bike/Skate Lane (narrow) | 2-3m | 5m |
| Bike/Skate Lane (wide) | 4-5m | 5m |
| Conveyor Sidewalk | 3-5m | 8m |
| Tram-Loop | 6-8m | 12m |

**Implementation**:
```javascript
function getMaxWidth(type) {
    const maxWidths = {
        'bike_skate_narrow': 5,
        'bike_skate_wide': 5,
        'conveyor': 8,
        'conveyor_wide': 8,
        'tram_loop': 12,
        'tram_loop_wide': 12
    };
    
    return maxWidths[type] || Infinity;
}
```

### Multi-Lane Generation

**Multi-Lane Logic**:
- When maximum width reached, consider adding parallel lanes
- Parallel lanes for bidirectional traffic
- Separate lanes for different directions

**Implementation**:
```javascript
class MultiLaneGenerator {
    checkMultiLane(infrastructure, trafficData) {
        // Check if at max width and still over capacity
        if (infrastructure.width >= this.getMaxWidth(infrastructure.type)) {
            const capacity = this.calculateCapacity(infrastructure.type, infrastructure.width);
            const trafficDensity = this.calculateTrafficDensity(infrastructure, trafficData);
            
            if (trafficDensity > capacity) {
                // Check bidirectional traffic
                const bidirectionalTraffic = this.analyzeBidirectionalTraffic(infrastructure, trafficData);
                
                if (bidirectionalTraffic.ratio > 0.3) {
                    // Add parallel lane for opposite direction
                    return this.createParallelLane(infrastructure, bidirectionalTraffic);
                }
            }
        }
        
        return null;
    }
    
    createParallelLane(infrastructure, trafficData) {
        // Create parallel infrastructure for opposite direction
        const parallelLane = {
            ...infrastructure,
            id: this.generateNewId(),
            direction: this.getOppositeDirection(infrastructure.direction),
            geometry: this.offsetGeometry(infrastructure.geometry, infrastructure.width)
        };
        
        return parallelLane;
    }
}
```

## Network Connectivity Algorithms

### Network Graph Construction

**Graph Building**:
- Nodes: Infrastructure endpoints and intersections
- Edges: Infrastructure segments
- Weights: Travel time/cost

**Implementation**:
```javascript
class TransportationNetwork {
    buildGraph() {
        const graph = new Graph();
        
        // Add nodes for infrastructure endpoints
        for (const infrastructure of this.getAllInfrastructure()) {
            const startNode = this.getOrCreateNode(infrastructure.start);
            const endNode = this.getOrCreateNode(infrastructure.end);
            
            // Add edge
            const cost = this.calculateEdgeCost(infrastructure);
            graph.addEdge(startNode, endNode, cost, {
                infrastructure: infrastructure,
                type: infrastructure.type
            });
        }
        
        // Add intersection nodes
        this.addIntersectionNodes(graph);
        
        return graph;
    }
    
    calculateEdgeCost(infrastructure) {
        const distance = infrastructure.geometry.length;
        const speed = this.getSpeed(infrastructure.type);
        return distance / speed; // Travel time
    }
    
    getSpeed(type) {
        const speeds = {
            'foot': 1.4, // m/s
            'bike_skate': 5,
            'conveyor': 3,
            'tram_loop': 20,
            'road': 15
        };
        
        return speeds[type] || 1.4;
    }
}
```

### Connectivity Analysis

**Connectivity Checks**:
- Ensure all zones are reachable
- Check for disconnected components
- Identify missing connections
- Suggest infrastructure to improve connectivity

**Implementation**:
```javascript
class ConnectivityAnalyzer {
    analyzeConnectivity(network, zones) {
        const components = this.findConnectedComponents(network);
        const zoneConnectivity = this.analyzeZoneConnectivity(network, zones);
        
        return {
            components: components,
            zoneConnectivity: zoneConnectivity,
            disconnectedZones: this.findDisconnectedZones(zoneConnectivity),
            missingConnections: this.identifyMissingConnections(network, zones)
        };
    }
    
    findConnectedComponents(network) {
        // Use DFS to find connected components
        const visited = new Set();
        const components = [];
        
        for (const node of network.nodes) {
            if (!visited.has(node)) {
                const component = this.dfs(network, node, visited);
                components.push(component);
            }
        }
        
        return components;
    }
    
    identifyMissingConnections(network, zones) {
        // Find zones that should be connected but aren't
        const missing = [];
        
        for (let i = 0; i < zones.length; i++) {
            for (let j = i + 1; j < zones.length; j++) {
                const zone1 = zones[i];
                const zone2 = zones[j];
                
                // Check if zones are nearby but not connected
                const distance = zone1.center.distanceTo(zone2.center);
                if (distance < 200 && !this.areConnected(network, zone1, zone2)) {
                    missing.push({
                        zone1: zone1,
                        zone2: zone2,
                        distance: distance
                    });
                }
            }
        }
        
        return missing;
    }
}
```

### Intersection Handling

**Intersection Types**:
- T-intersections
- Cross-intersections
- Roundabouts (future)
- Multi-level intersections (future)

**Intersection Generation**:
```javascript
class IntersectionGenerator {
    generateIntersection(segments) {
        // Find intersection point
        const intersectionPoint = this.findIntersectionPoint(segments);
        
        // Create intersection node
        const intersection = {
            point: intersectionPoint,
            segments: segments,
            type: this.determineIntersectionType(segments)
        };
        
        // Connect segments through intersection
        this.connectSegments(intersection);
        
        return intersection;
    }
    
    determineIntersectionType(segments) {
        if (segments.length === 2) {
            return 'simple';
        } else if (segments.length === 3) {
            return 't_intersection';
        } else if (segments.length === 4) {
            return 'cross_intersection';
        } else {
            return 'complex';
        }
    }
}
```

### Maglev Integration

**Maglev Connection**:
- Connect transportation network to maglev stations
- Maglev for long-distance travel
- Integration points at elevator stations

**Implementation**:
```javascript
class MaglevIntegrator {
    integrateMaglev(network, maglevStations) {
        for (const station of maglevStations) {
            // Find nearby transportation infrastructure
            const nearbyInfrastructure = this.findNearbyInfrastructure(station, 100);
            
            // Create connection nodes
            for (const infrastructure of nearbyInfrastructure) {
                const connectionNode = this.createConnectionNode(station, infrastructure);
                network.addNode(connectionNode);
                
                // Add edges
                network.addEdge(connectionNode, station, 0, { type: 'maglev_access' });
                network.addEdge(infrastructure.end, connectionNode, 10, { type: 'walk' });
            }
        }
    }
}
```

## Transportation Hierarchy

### Transportation Types

**Hierarchy** (slowest to fastest):
1. **Foot Traffic**: Default, always available
2. **Bike/Skate Lanes**: Personal mobility
3. **Conveyor Sidewalks**: Short-distance mass transit
4. **Tram-Loops**: Medium-distance mass transit
5. **Road Lanes**: Hub areas only
6. **Maglev**: Long-distance (system-defined)

### Hierarchy Rules

**Selection Rules**:
- NPCs prefer faster modes for longer distances
- Consider availability and schedules
- Balance speed vs. accessibility

**Implementation**:
```javascript
class TransportationHierarchy {
    selectTransportationMode(start, end, distance) {
        // Maglev for very long distances
        if (distance > 2000 && this.hasMaglevAccess(start, end)) {
            return 'maglev';
        }
        
        // Tram for medium distances with high traffic
        if (distance > 500 && distance < 2000 && this.hasTram(start, end)) {
            return 'tram_loop';
        }
        
        // Conveyor for short distances with high traffic
        if (distance < 1000 && this.hasConveyor(start, end)) {
            return 'conveyor';
        }
        
        // Bike/skate for medium distances
        if (distance < 500 && this.hasBikeSkate(start, end)) {
            return 'bike_skate';
        }
        
        // Default to foot
        return 'foot';
    }
}
```

### Mode Transitions

**Transition Points**:
- Where NPCs switch transportation modes
- Located at infrastructure intersections
- Consider transition costs

**Implementation**:
```javascript
class ModeTransitionManager {
    findTransitionPoints(route) {
        const transitions = [];
        
        for (let i = 0; i < route.segments.length - 1; i++) {
            const current = route.segments[i];
            const next = route.segments[i + 1];
            
            if (current.type !== next.type) {
                transitions.push({
                    point: current.end,
                    fromType: current.type,
                    toType: next.type,
                    cost: this.calculateTransitionCost(current.type, next.type)
                });
            }
        }
        
        return transitions;
    }
    
    calculateTransitionCost(fromType, toType) {
        // Transition costs (time in seconds)
        const costs = {
            'foot_to_conveyor': 5,
            'foot_to_tram': 10,
            'conveyor_to_tram': 5,
            'tram_to_maglev': 30,
            // ... etc
        };
        
        const key = `${fromType}_to_${toType}`;
        return costs[key] || 0;
    }
}
```

## Performance Optimization

### Incremental Updates

**Update Strategy**:
- Only update changed segments
- Batch updates for efficiency
- Defer non-critical updates

**Implementation**:
```javascript
class IncrementalUpdater {
    updateInfrastructure(changedSegments) {
        // Only process changed segments
        for (const segment of changedSegments) {
            const trafficData = this.getTrafficData(segment);
            const infrastructure = this.findInfrastructure(segment);
            
            if (infrastructure) {
                this.checkUpdate(infrastructure, trafficData);
            } else {
                this.checkGeneration(segment, trafficData);
            }
        }
    }
}
```

### Spatial Indexing

**Spatial Queries**:
- Use PostGIS spatial indexes
- Efficient segment queries
- Proximity searches

**Implementation**:
```sql
-- Spatial index for efficient queries
CREATE INDEX idx_infrastructure_geometry ON infrastructure USING GIST(geometry);
CREATE INDEX idx_traffic_segment ON npc_traffic USING GIST(segment);

-- Query nearby infrastructure
SELECT * FROM infrastructure 
WHERE ST_DWithin(geometry, ST_MakePoint($1, $2), $3);
```

### Batch Processing

**Batch Updates**:
- Process multiple segments together
- Reduce database queries
- Optimize network updates

**Implementation**:
```javascript
class BatchProcessor {
    processBatch(segments, batchSize = 100) {
        const batches = this.chunkArray(segments, batchSize);
        
        for (const batch of batches) {
            // Process batch
            const trafficData = this.queryTrafficDataBatch(batch);
            const infrastructureUpdates = this.calculateUpdates(batch, trafficData);
            
            // Apply updates
            this.applyUpdatesBatch(infrastructureUpdates);
        }
    }
}
```

### Caching Strategies

**Cache Traffic Data**:
- Cache aggregated traffic data
- Invalidate on updates
- Reduce redundant calculations

**Implementation**:
```javascript
class TrafficDataCache {
    constructor(ttl = 3600000) { // 1 hour
        this.cache = new Map();
        this.ttl = ttl;
    }
    
    getTrafficData(segment, timeWindow) {
        const key = this.getCacheKey(segment, timeWindow);
        
        if (this.cache.has(key)) {
            const cached = this.cache.get(key);
            if (Date.now() - cached.timestamp < this.ttl) {
                return cached.data;
            }
        }
        
        // Calculate and cache
        const data = this.calculateTrafficData(segment, timeWindow);
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
        
        return data;
    }
}
```

## Traffic Pattern Stability

### In-Game Week Requirement

**Stability Requirement**:
- Traffic patterns must be sustained for in-game week before infrastructure changes
- Prevents temporary events from causing changes
- Ensures stable infrastructure

**Implementation**:
```javascript
class TrafficPatternAnalyzer {
    isTrafficSustained(segment, timeWindow, duration) {
        // Analyze traffic over duration
        const timeSteps = duration / timeWindow;
        const trafficHistory = [];
        
        for (let i = 0; i < timeSteps; i++) {
            const startTime = Date.now() - (i + 1) * timeWindow;
            const endTime = Date.now() - i * timeWindow;
            const traffic = this.getTrafficData(segment, startTime, endTime);
            trafficHistory.push(traffic);
        }
        
        // Check if traffic consistently above/below threshold
        return this.isConsistent(trafficHistory);
    }
    
    isConsistent(trafficHistory, threshold) {
        // Check if all values are above or below threshold
        const aboveThreshold = trafficHistory.every(t => t > threshold);
        const belowThreshold = trafficHistory.every(t => t < threshold);
        
        return aboveThreshold || belowThreshold;
    }
}
```

### Pattern Recognition

**Pattern Detection**:
- Identify recurring patterns
- Distinguish temporary vs. permanent changes
- Predict future traffic

**Implementation**:
```javascript
class PatternRecognizer {
    recognizePattern(trafficHistory) {
        // Analyze for patterns
        const patterns = {
            daily: this.detectDailyPattern(trafficHistory),
            weekly: this.detectWeeklyPattern(trafficHistory),
            trend: this.detectTrend(trafficHistory),
            seasonal: this.detectSeasonalPattern(trafficHistory)
        };
        
        return patterns;
    }
    
    detectTrend(trafficHistory) {
        // Linear regression to detect trend
        const n = trafficHistory.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += trafficHistory[i];
            sumXY += i * trafficHistory[i];
            sumX2 += i * i;
        }
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable';
    }
}
```

### Temporary Event Filtering

**Event Filtering**:
- Identify temporary events (races, gatherings, etc.)
- Filter out temporary traffic spikes
- Only consider sustained patterns

**Implementation**:
```javascript
class EventFilter {
    filterTemporaryEvents(trafficData) {
        // Identify spikes
        const spikes = this.identifySpikes(trafficData);
        
        // Check if spikes are temporary
        const filteredData = trafficData.filter(point => {
            const isSpike = spikes.some(spike => 
                Math.abs(point.time - spike.time) < spike.duration
            );
            
            if (isSpike) {
                // Check if spike is temporary (short duration)
                const spikeData = spikes.find(s => Math.abs(point.time - s.time) < s.duration);
                return spikeData.duration > 3600000; // Longer than 1 hour
            }
            
            return true;
        });
        
        return filteredData;
    }
    
    identifySpikes(trafficData) {
        const spikes = [];
        const average = this.calculateAverage(trafficData);
        const threshold = average * 1.5; // 50% above average
        
        for (let i = 1; i < trafficData.length - 1; i++) {
            if (trafficData[i].density > threshold) {
                spikes.push({
                    time: trafficData[i].time,
                    density: trafficData[i].density,
                    duration: this.calculateSpikeDuration(trafficData, i)
                });
            }
        }
        
        return spikes;
    }
}
```

## Manual Infrastructure Placement

### Infrastructure Manager Role

**Role Permissions**:
- Can manually place transportation infrastructure
- Can override automatic generation
- Can modify existing infrastructure
- Can remove infrastructure

**Implementation**:
```javascript
class InfrastructureManagerRole {
    canPlaceInfrastructure(player) {
        return player.roles.includes('infrastructure_manager');
    }
    
    placeInfrastructure(player, infrastructure) {
        if (!this.canPlaceInfrastructure(player)) {
            throw new Error('Insufficient permissions');
        }
        
        // Validate infrastructure
        this.validateInfrastructure(infrastructure);
        
        // Place infrastructure
        this.addInfrastructure(infrastructure, { manual: true, placedBy: player.id });
        
        // Update network
        this.updateNetworkConnectivity();
    }
}
```

### Manual Placement Rules

**Placement Validation**:
- Must use valid infrastructure types
- Must respect zone boundaries
- Must connect to network
- Cannot overlap existing infrastructure (unless replacing)

**Implementation**:
```javascript
class ManualPlacementValidator {
    validatePlacement(infrastructure, existingInfrastructure) {
        // Check type validity
        if (!this.isValidType(infrastructure.type)) {
            throw new Error('Invalid infrastructure type');
        }
        
        // Check zone boundaries
        if (!this.respectsZoneBoundaries(infrastructure)) {
            throw new Error('Infrastructure violates zone boundaries');
        }
        
        // Check overlaps
        const overlaps = this.findOverlaps(infrastructure, existingInfrastructure);
        if (overlaps.length > 0 && !infrastructure.replaceExisting) {
            throw new Error('Infrastructure overlaps existing infrastructure');
        }
        
        // Check network connectivity
        if (!this.connectsToNetwork(infrastructure, existingInfrastructure)) {
            throw new Error('Infrastructure does not connect to network');
        }
        
        return true;
    }
}
```

### Override System

**Override Automatic Generation**:
- Manual infrastructure takes priority
- Prevents automatic changes to manual infrastructure
- Can mark infrastructure as "protected"

**Implementation**:
```javascript
class OverrideSystem {
    checkOverride(infrastructure) {
        // Manual infrastructure cannot be automatically modified
        if (infrastructure.manual && infrastructure.protected) {
            return true;
        }
        
        return false;
    }
    
    protectInfrastructure(infrastructure) {
        infrastructure.protected = true;
    }
    
    unprotectInfrastructure(infrastructure) {
        infrastructure.protected = false;
    }
}
```

## Implementation Phases

### Phase 1: Traffic Data Collection
- Path recording system
- Traffic data storage
- Basic aggregation

### Phase 2: Traffic Density Calculation
- Density formulas
- Time weighting
- Segment analysis

### Phase 3: Infrastructure Generation
- Threshold-based generation
- Network connectivity
- Initial infrastructure creation

### Phase 4: Upgrade/Downgrade System
- Upgrade thresholds and process
- Downgrade thresholds and process
- Hysteresis system

### Phase 5: Lane Widening
- Widening algorithms
- Multi-lane generation
- Width management

### Phase 6: Performance Optimization
- Incremental updates
- Spatial indexing
- Batch processing
- Caching

### Phase 7: Manual Placement
- Infrastructure Manager role
- Manual placement system
- Override system

## Open Questions

1. What are the exact threshold values for each infrastructure type?
2. How should we handle infrastructure at zone boundaries?
3. Should infrastructure generation consider elevation changes?
4. How do we balance performance with update frequency?

## Future Considerations

- More sophisticated pattern recognition
- Predictive infrastructure generation
- Dynamic infrastructure scheduling
- Advanced intersection types
- Multi-level transportation (elevated, underground)
- Integration with procedural generation
- Player feedback on infrastructure placement

