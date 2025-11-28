# NPC AI and Pathfinding Specification

**Status**: 📋 **DESIGN SPECIFICATION** - This document specifies the planned NPC AI and pathfinding system implementation.

**Related Documentation**:
- [Game Mechanics](10-game-mechanics.md) - NPC system overview and game mechanics
- [Zone System](09-zone-system.md) - Zone-based pathfinding and NPC behavior
- [Transportation Generation](13-transportation-generation.md) - Transportation network used for pathfinding
- [Database Schema](03-database-schema.md) - NPC data storage
- [Implementation Phases](../implementation-phases.md) - Feature implementation roadmap

## Table of Contents

- [Overview](#overview)
- [NPC System Architecture](#npc-system-architecture)
  - [Two-Tier Complexity Model](#two-tier-complexity-model)
  - [Abstract Mass NPCs](#abstract-mass-npcs)
  - [Detailed Individual NPCs](#detailed-individual-npcs)
  - [Complexity Transition](#complexity-transition)
- [Pathfinding Architecture](#pathfinding-architecture)
  - [Pathfinding Layers](#pathfinding-layers)
  - [Zone-Level Pathfinding](#zone-level-pathfinding)
  - [Transportation Network Pathfinding](#transportation-network-pathfinding)
  - [Hybrid Pathfinding](#hybrid-pathfinding)
- [A* Pathfinding Algorithm](#a-pathfinding-algorithm)
  - [Algorithm Overview](#algorithm-overview)
  - [Heuristic Functions](#heuristic-functions)
  - [Cost Functions](#cost-functions)
  - [Multi-Modal Transportation](#multi-modal-transportation)
- [NPC Decision Making](#npc-decision-making)
  - [Needs-Based Decisions](#needs-based-decisions)
  - [Relationship-Based Decisions](#relationship-based-decisions)
  - [Behavior Trees](#behavior-trees)
  - [Abstract vs Detailed Decision Making](#abstract-vs-detailed-decision-making)
- [NPC Favoritism System](#npc-favoritism-system)
  - [Favoritism Tracking](#favoritism-tracking)
  - [Detail Scaling](#detail-scaling)
  - [Performance Management](#performance-management)
- [Performance Optimization](#performance-optimization)
  - [Spatial Partitioning](#spatial-partitioning)
  - [Path Caching](#path-caching)
  - [Abstract Mass Optimization](#abstract-mass-optimization)
  - [Hierarchical Pathfinding](#hierarchical-pathfinding)
- [Implementation Phases](#implementation-phases)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

This document specifies the implementation details for NPC AI and pathfinding in EarthRing. The system must support large NPC populations efficiently while providing detailed behavior for selected NPCs. Pathfinding must handle the complex transportation network including multiple transportation modes.

**Key Requirements:**
- **Two-Tier Complexity**: Abstract mass for performance, detailed individuals when selected
- **Efficient Pathfinding**: Handle large NPC populations with good performance
- **Multi-Modal Transportation**: Support foot, conveyor, tram, maglev transportation
- **Needs-Based Behavior**: NPCs make decisions based on needs and relationships
- **Favoritism System**: Previously selected NPCs gain more detail and attention

**Design Philosophy:**
- Performance first: Abstract mass allows thousands of NPCs
- Detail on demand: Selected NPCs gain full complexity
- Realistic behavior: NPCs follow realistic routines and needs
- Relationship tracking: NPCs maintain relationships even when abstract

## NPC System Architecture

### Two-Tier Complexity Model

**Design Decision**: NPCs exist in two states - abstract mass (default) and detailed individual (when selected).

**Abstract Mass State** (Default):
- NPCs modeled in aggregate for performance
- Basic needs and behaviors simulated at population level
- Relationships tracked abstractly
- Minimal individual detail
- Contributes to traffic patterns

**Detailed Individual State** (When Selected):
- Full complexity, personality, and history
- Individual relationships become explicit
- Full Sims-like needs and behaviors
- Can be controlled by player
- Detailed pathfinding and decision-making

**Transition**:
- Selection triggers transition from abstract to detailed
- Relationship data preserved during transition
- Can transition back to abstract when deselected (with favoritism)

### Abstract Mass NPCs

**Modeling Approach**:
- Groups of NPCs modeled as aggregate entities
- Population-level statistics and behaviors
- Aggregate pathfinding (zone-to-zone)
- Traffic generation from aggregate movement

**Implementation**:
```javascript
class AbstractNPCMass {
    constructor(zone, population, npcType) {
        this.zone = zone;
        this.population = population; // Number of NPCs in mass
        this.npcType = npcType; // 'resident', 'worker', 'visitor'
        this.aggregateNeeds = {
            housing: 0.8, // Average housing need (0-1)
            work: 0.7,
            food: 0.6,
            recreation: 0.5
        };
        this.currentActivity = 'idle';
        this.targetZone = null;
    }
    
    update(dt) {
        // Update aggregate needs
        this.updateAggregateNeeds(dt);
        
        // Decide on next activity based on needs
        const nextActivity = this.decideNextActivity();
        
        if (nextActivity !== this.currentActivity) {
            this.startActivity(nextActivity);
        }
        
        // Generate traffic if moving
        if (this.isMoving()) {
            this.generateTraffic();
        }
    }
    
    decideNextActivity() {
        // Simple decision making based on aggregate needs
        if (this.aggregateNeeds.food < 0.3) {
            return 'seeking_food';
        }
        if (this.aggregateNeeds.work < 0.3 && this.isWorkTime()) {
            return 'going_to_work';
        }
        if (this.aggregateNeeds.recreation < 0.2) {
            return 'seeking_recreation';
        }
        return 'idle';
    }
    
    generateTraffic() {
        // Generate traffic data for transportation system
        const path = this.calculateZonePath(this.zone, this.targetZone);
        this.trafficSystem.recordPath(path, this.population);
    }
}
```

**Key Characteristics**:
- Minimal computational cost per NPC
- Supports thousands of NPCs efficiently
- Still maintains basic autonomy and routines
- Contributes to city dynamics and traffic

### Detailed Individual NPCs

**Modeling Approach**:
- Full individual simulation
- Detailed needs, personality, relationships
- Individual pathfinding (precise routes)
- Detailed decision-making

**Implementation**:
```javascript
class DetailedNPC {
    constructor(abstractNPCData) {
        // Initialize from abstract NPC data
        this.id = abstractNPCData.id;
        this.name = this.generateName();
        this.personality = this.generatePersonality();
        this.relationships = this.expandRelationships(abstractNPCData.abstractRelationships);
        this.needs = {
            housing: abstractNPCData.aggregateNeeds.housing,
            work: abstractNPCData.aggregateNeeds.work,
            food: abstractNPCData.aggregateNeeds.food,
            recreation: abstractNPCData.aggregateNeeds.recreation,
            social: 0.5,
            comfort: 0.5
        };
        this.currentGoal = null;
        this.path = null;
        this.favoritismPoints = abstractNPCData.favoritismPoints || 0;
    }
    
    update(dt) {
        // Update individual needs
        this.updateNeeds(dt);
        
        // Detailed decision making
        this.updateGoal();
        
        // Detailed pathfinding
        if (this.currentGoal) {
            this.updatePathfinding();
        }
        
        // Update relationships
        this.updateRelationships(dt);
    }
    
    updateGoal() {
        // Complex decision making based on needs, relationships, personality
        const goal = this.decisionTree.evaluate(this.needs, this.relationships, this.personality);
        if (goal !== this.currentGoal) {
            this.setGoal(goal);
        }
    }
}
```

**Key Characteristics**:
- High computational cost
- Limited number can be detailed at once
- Full Sims-like behavior
- Rich interactions and relationships

### Complexity Transition

**Transition from Abstract to Detailed**:
```javascript
class NPCComplexityManager {
    transitionToDetailed(abstractNPC) {
        // Generate detailed NPC from abstract data
        const detailedNPC = new DetailedNPC(abstractNPC);
        
        // Expand relationships
        detailedNPC.relationships = this.expandRelationships(abstractNPC.abstractRelationships);
        
        // Generate personality and history
        detailedNPC.personality = this.generatePersonality(detailedNPC.id);
        detailedNPC.history = this.generateHistory(detailedNPC);
        
        // Initialize detailed needs from abstract needs
        detailedNPC.needs = this.initializeDetailedNeeds(abstractNPC.aggregateNeeds);
        
        return detailedNPC;
    }
    
    transitionToAbstract(detailedNPC) {
        // Preserve key data when transitioning back
        const abstractNPC = {
            id: detailedNPC.id,
            aggregateNeeds: this.calculateAggregateNeeds(detailedNPC.needs),
            abstractRelationships: this.summarizeRelationships(detailedNPC.relationships),
            favoritismPoints: detailedNPC.favoritismPoints,
            lastDetailedTime: Date.now()
        };
        
        return abstractNPC;
    }
}
```

**Key Points**:
- Relationship data preserved during transition
- Personality and history generated deterministically
- Favoritism points maintained
- Can transition back and forth as needed

## Pathfinding Architecture

### Pathfinding Layers

**Three-Layer Architecture**:
1. **Zone-Level Pathfinding**: High-level zone-to-zone navigation
2. **Transportation Network Pathfinding**: Route through transportation infrastructure
3. **Precise Pathfinding**: Exact path within zones/transportation

**Layer Selection**:
- Abstract NPCs: Zone-level only
- Detailed NPCs: All three layers
- Favoritism NPCs: Zone-level + transportation network

### Zone-Level Pathfinding

**Purpose**: Find path through zone network for abstract NPCs. See [Zone System Documentation](09-zone-system.md#zone-to-zone-connectivity) for zone connectivity details.

**Implementation**:
```javascript
class ZonePathfinder {
    findZonePath(startZone, targetZone) {
        // Use A* on zone connectivity graph
        const graph = this.buildZoneGraph();
        const path = this.aStar(graph, startZone, targetZone);
        return path;
    }
    
    buildZoneGraph() {
        // Build graph from zone connectivity
        const graph = new Graph();
        
        for (const zone of this.zones) {
            const neighbors = this.findConnectedZones(zone);
            for (const neighbor of neighbors) {
                const cost = this.calculateZoneTransitionCost(zone, neighbor);
                graph.addEdge(zone.id, neighbor.id, cost);
            }
        }
        
        return graph;
    }
    
    calculateZoneTransitionCost(zone1, zone2) {
        // Cost based on distance, zone types, transportation availability
        const distance = this.calculateZoneDistance(zone1, zone2);
        const typeCost = this.getZoneTypeTransitionCost(zone1.type, zone2.type);
        const transportCost = this.getTransportationCost(zone1, zone2);
        
        return distance + typeCost + transportCost;
    }
}
```

**Use Cases**:
- Abstract NPC movement
- High-level route planning
- Zone connectivity analysis

### Transportation Network Pathfinding

**Purpose**: Find route through transportation infrastructure (foot, conveyor, tram, maglev). See [Transportation Generation Documentation](13-transportation-generation.md) for transportation network details.

**Transportation Types**:
1. **Foot Traffic**: Default, slowest, always available
2. **Bike/Skate Lanes**: Medium speed, short distance
3. **Conveyor Sidewalks**: Faster, short distance
4. **Tram-Loops**: Faster, medium distance
5. **Road Lanes**: Variable speed, only at hubs
6. **Maglev**: Fastest, long distance

**Implementation**:
```javascript
class TransportationPathfinder {
    findTransportationPath(start, end) {
        // Build transportation network graph
        const network = this.buildTransportationNetwork();
        
        // Find path using A* with multi-modal transportation
        const path = this.aStarMultiModal(network, start, end);
        
        return path;
    }
    
    buildTransportationNetwork() {
        const network = new Graph();
        
        // Add nodes for transportation infrastructure
        for (const segment of this.transportationSegments) {
            network.addNode(segment.id, {
                type: segment.type,
                position: segment.position,
                speed: segment.speed,
                capacity: segment.capacity
            });
        }
        
        // Add edges for connections
        for (const segment of this.transportationSegments) {
            const connections = this.findConnections(segment);
            for (const connection of connections) {
                const cost = this.calculateTransportationCost(segment, connection);
                network.addEdge(segment.id, connection.id, cost);
            }
        }
        
        return network;
    }
    
    calculateTransportationCost(segment1, segment2) {
        // Cost based on distance, speed, transportation type
        const distance = this.calculateDistance(segment1.position, segment2.position);
        const speed = Math.min(segment1.speed, segment2.speed);
        const time = distance / speed;
        
        // Add transition cost for mode changes
        const transitionCost = segment1.type !== segment2.type ? 10 : 0;
        
        return time + transitionCost;
    }
}
```

**Multi-Modal Considerations**:
- NPCs can switch transportation modes
- Transition costs for mode changes
- Prefer faster modes for long distances
- Consider availability (tram schedules, etc.)

### Hybrid Pathfinding

**Purpose**: Combine zone-level and transportation-level pathfinding for optimal routes.

**Implementation**:
```javascript
class HybridPathfinder {
    findHybridPath(startZone, endZone, startPosition, endPosition) {
        // Step 1: Find zone path
        const zonePath = this.zonePathfinder.findZonePath(startZone, endZone);
        
        // Step 2: For each zone transition, find transportation path
        const fullPath = [];
        
        for (let i = 0; i < zonePath.length - 1; i++) {
            const currentZone = zonePath[i];
            const nextZone = zonePath[i + 1];
            
            // Find transportation path between zones
            const transportPath = this.transportationPathfinder.findTransportationPath(
                currentZone.center,
                nextZone.center
            );
            
            fullPath.push(...transportPath);
        }
        
        // Step 3: Optimize path (remove unnecessary waypoints)
        return this.optimizePath(fullPath);
    }
    
    optimizePath(path) {
        // Remove redundant waypoints
        // Simplify path while maintaining validity
        const optimized = [];
        
        for (let i = 0; i < path.length; i++) {
            // Check if we can skip this waypoint
            if (i === 0 || i === path.length - 1) {
                optimized.push(path[i]);
            } else {
                // Check if direct path from previous to next is valid
                if (!this.isDirectPathValid(path[i - 1], path[i + 1])) {
                    optimized.push(path[i]);
                }
            }
        }
        
        return optimized;
    }
}
```

**Use Cases**:
- Detailed NPC pathfinding
- Long-distance NPC movement
- Multi-zone route planning

## A* Pathfinding Algorithm

### Algorithm Overview

**A* Algorithm**: Optimal pathfinding algorithm using heuristic estimates.

**Basic Algorithm**:
```javascript
class AStarPathfinder {
    findPath(graph, start, goal) {
        const openSet = new PriorityQueue();
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map(); // Cost from start
        const fScore = new Map(); // Estimated total cost
        
        // Initialize
        gScore.set(start, 0);
        fScore.set(start, this.heuristic(start, goal));
        openSet.add(start, fScore.get(start));
        
        while (!openSet.isEmpty()) {
            const current = openSet.poll();
            
            if (current === goal) {
                return this.reconstructPath(cameFrom, current);
            }
            
            closedSet.add(current);
            
            // Check neighbors
            const neighbors = graph.getNeighbors(current);
            for (const neighbor of neighbors) {
                if (closedSet.has(neighbor)) {
                    continue;
                }
                
                const tentativeGScore = gScore.get(current) + 
                                       graph.getEdgeCost(current, neighbor);
                
                if (!openSet.contains(neighbor)) {
                    openSet.add(neighbor, Infinity);
                } else if (tentativeGScore >= gScore.get(neighbor)) {
                    continue; // Not a better path
                }
                
                // This path is better
                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeGScore);
                fScore.set(neighbor, tentativeGScore + this.heuristic(neighbor, goal));
                openSet.update(neighbor, fScore.get(neighbor));
            }
        }
        
        return null; // No path found
    }
    
    reconstructPath(cameFrom, current) {
        const path = [current];
        while (cameFrom.has(current)) {
            current = cameFrom.get(current);
            path.unshift(current);
        }
        return path;
    }
}
```

### Heuristic Functions

**Zone-Level Heuristic**:
```javascript
function zoneHeuristic(zone1, zone2) {
    // Euclidean distance between zone centers
    return zone1.center.distanceTo(zone2.center);
}
```

**Transportation Network Heuristic**:
```javascript
function transportationHeuristic(node1, node2) {
    // Straight-line distance divided by maximum speed
    const distance = node1.position.distanceTo(node2.position);
    const maxSpeed = Math.max(node1.speed, node2.speed, 1); // At least walking speed
    return distance / maxSpeed; // Time estimate
}
```

**Multi-Modal Heuristic**:
```javascript
function multiModalHeuristic(node1, node2) {
    // Consider transportation type
    const distance = node1.position.distanceTo(node2.position);
    
    // Estimate based on best available transportation
    let bestSpeed = 1; // Walking speed (m/s)
    if (node1.hasMaglev || node2.hasMaglev) {
        bestSpeed = 100; // Maglev speed
    } else if (node1.hasTram || node2.hasTram) {
        bestSpeed = 20; // Tram speed
    } else if (node1.hasConveyor || node2.hasConveyor) {
        bestSpeed = 5; // Conveyor speed
    }
    
    return distance / bestSpeed;
}
```

### Cost Functions

**Zone Transition Cost**:
```javascript
function calculateZoneTransitionCost(zone1, zone2) {
    const distance = zone1.center.distanceTo(zone2.center);
    
    // Type-based costs
    const typeCosts = {
        'residential_to_commercial': 5,
        'commercial_to_residential': 5,
        'residential_to_work': 10,
        'work_to_residential': 10
    };
    
    const typeKey = `${zone1.type}_to_${zone2.type}`;
    const typeCost = typeCosts[typeKey] || 0;
    
    return distance + typeCost;
}
```

**Transportation Cost**:
```javascript
function calculateTransportationCost(segment1, segment2) {
    const distance = segment1.position.distanceTo(segment2.position);
    const speed = Math.min(segment1.speed, segment2.speed);
    const time = distance / speed;
    
    // Mode transition cost
    const transitionCost = segment1.type !== segment2.type ? 5 : 0;
    
    // Congestion cost
    const congestionCost = (segment1.congestion + segment2.congestion) * 2;
    
    return time + transitionCost + congestionCost;
}
```

### Multi-Modal Transportation

**Mode Selection**:
```javascript
class MultiModalPathfinder {
    findOptimalMode(start, end, distance) {
        const modes = [];
        
        // Always available: foot
        modes.push({
            type: 'foot',
            speed: 1.4, // m/s (walking speed)
            cost: distance / 1.4,
            available: true
        });
        
        // Check available transportation
        if (this.hasConveyor(start, end)) {
            modes.push({
                type: 'conveyor',
                speed: 5,
                cost: distance / 5 + 2, // + transition cost
                available: true
            });
        }
        
        if (this.hasTram(start, end)) {
            modes.push({
                type: 'tram',
                speed: 20,
                cost: distance / 20 + 5, // + wait time
                available: this.isTramAvailable()
            });
        }
        
        if (this.hasMaglev(start, end)) {
            modes.push({
                type: 'maglev',
                speed: 100,
                cost: distance / 100 + 10, // + station access
                available: true
            });
        }
        
        // Select best mode (lowest cost)
        return modes.filter(m => m.available)
                   .sort((a, b) => a.cost - b.cost)[0];
    }
}
```

## NPC Decision Making

### Needs-Based Decisions

**Needs System**:
- Housing, work, food, recreation, social, comfort
- Needs decrease over time
- NPCs seek to satisfy needs

**Decision Making**:
```javascript
class NeedsBasedDecisionMaker {
    decideNextAction(npc) {
        // Prioritize needs
        const prioritizedNeeds = this.prioritizeNeeds(npc.needs);
        
        // Find action to satisfy highest priority need
        for (const need of prioritizedNeeds) {
            const action = this.findActionForNeed(need, npc);
            if (action) {
                return action;
            }
        }
        
        return 'idle';
    }
    
    prioritizeNeeds(needs) {
        // Sort needs by urgency (low values = more urgent)
        return Object.entries(needs)
            .sort((a, b) => a[1] - b[1])
            .map(([need, value]) => need);
    }
    
    findActionForNeed(need, npc) {
        switch (need) {
            case 'food':
                return this.findFoodSource(npc);
            case 'work':
                return this.findWorkplace(npc);
            case 'housing':
                return this.findHousing(npc);
            case 'recreation':
                return this.findRecreation(npc);
            default:
                return null;
        }
    }
}
```

### Relationship-Based Decisions

**Relationship Influence**:
- NPCs prefer businesses they have relationships with
- Social needs influence destination choices
- Relationships affect path selection

**Implementation**:
```javascript
class RelationshipBasedDecisionMaker {
    decideDestination(npc, need) {
        const candidates = this.findCandidates(npc, need);
        
        // Score candidates based on relationships
        const scored = candidates.map(candidate => ({
            candidate: candidate,
            score: this.calculateRelationshipScore(npc, candidate)
        }));
        
        // Select best candidate
        scored.sort((a, b) => b.score - a.score);
        return scored[0].candidate;
    }
    
    calculateRelationshipScore(npc, candidate) {
        let score = 0;
        
        // Base score (distance, quality, etc.)
        score += this.calculateBaseScore(npc, candidate);
        
        // Relationship bonus
        const relationship = npc.relationships.get(candidate.id);
        if (relationship) {
            score += relationship.strength * 10; // Relationship multiplier
        }
        
        // Preference bonus
        if (npc.preferences.includes(candidate.type)) {
            score += 5;
        }
        
        return score;
    }
}
```

### Behavior Trees

**Behavior Tree Structure**:
- Hierarchical decision making
- Composites (Sequence, Selector, Parallel)
- Leaf nodes (Actions, Conditions)

**Implementation**:
```javascript
class BehaviorTree {
    constructor(root) {
        this.root = root;
    }
    
    tick(npc) {
        return this.root.execute(npc);
    }
}

class SelectorNode {
    constructor(children) {
        this.children = children;
    }
    
    execute(npc) {
        for (const child of this.children) {
            const result = child.execute(npc);
            if (result === 'success') {
                return 'success';
            }
        }
        return 'failure';
    }
}

class SequenceNode {
    constructor(children) {
        this.children = children;
    }
    
    execute(npc) {
        for (const child of this.children) {
            const result = child.execute(npc);
            if (result === 'failure') {
                return 'failure';
            }
        }
        return 'success';
    }
}

class CheckNeedNode {
    constructor(need, threshold) {
        this.need = need;
        this.threshold = threshold;
    }
    
    execute(npc) {
        return npc.needs[this.need] < this.threshold ? 'success' : 'failure';
    }
}

class FindFoodAction {
    execute(npc) {
        const foodSource = npc.decisionMaker.findFoodSource(npc);
        if (foodSource) {
            npc.setGoal(foodSource);
            return 'success';
        }
        return 'failure';
    }
}
```

### Abstract vs Detailed Decision Making

**Abstract Decision Making**:
- Simple rule-based decisions
- Aggregate needs and behaviors
- Zone-level choices

**Detailed Decision Making**:
- Complex behavior trees
- Individual needs and preferences
- Relationship influences
- Personality affects decisions

**Implementation**:
```javascript
class NPCDecisionMaker {
    constructor(npc) {
        this.npc = npc;
        this.isAbstract = npc.isAbstract;
        
        if (this.isAbstract) {
            this.decisionTree = new SimpleDecisionTree();
        } else {
            this.decisionTree = new ComplexBehaviorTree(npc.personality);
        }
    }
    
    decideNextAction() {
        return this.decisionTree.tick(this.npc);
    }
}
```

## NPC Favoritism System

### Favoritism Tracking

**Favoritism Points**:
- Gained each time NPC is selected
- Persist across sessions
- Affect detail level when not selected

**Implementation**:
```javascript
class FavoritismSystem {
    recordSelection(npcId) {
        const npc = this.getNPC(npcId);
        npc.favoritismPoints = (npc.favoritismPoints || 0) + 1;
        npc.lastSelectedTime = Date.now();
        
        // Persist to database
        this.saveFavoritismData(npcId, npc.favoritismPoints);
    }
    
    getFavoritismLevel(npcId) {
        const npc = this.getNPC(npcId);
        const points = npc.favoritismPoints || 0;
        
        if (points >= 10) {
            return 'high';
        } else if (points >= 5) {
            return 'medium';
        } else if (points >= 1) {
            return 'low';
        }
        
        return 'none';
    }
}
```

### Detail Scaling

**Detail Levels Based on Favoritism**:
- **None**: Abstract mass only
- **Low**: Slightly more detail, basic individual tracking
- **Medium**: Individual tracking, simplified decision making
- **High**: Near-full detail, complex decision making

**Implementation**:
```javascript
class DetailScaler {
    getDetailLevel(npc) {
        if (npc.isSelected) {
            return 'full';
        }
        
        const favoritismLevel = this.favoritismSystem.getFavoritismLevel(npc.id);
        
        switch (favoritismLevel) {
            case 'high':
                return 'near_full';
            case 'medium':
                return 'medium';
            case 'low':
                return 'low';
            default:
                return 'abstract';
        }
    }
    
    applyDetailLevel(npc, level) {
        switch (level) {
            case 'full':
                // Full detail: all systems active
                npc.enableFullDetail();
                break;
            case 'near_full':
                // Near-full: most systems, simplified some
                npc.enableNearFullDetail();
                break;
            case 'medium':
                // Medium: individual tracking, simplified decisions
                npc.enableMediumDetail();
                break;
            case 'low':
                // Low: basic individual tracking
                npc.enableLowDetail();
                break;
            case 'abstract':
                // Abstract: aggregate only
                npc.enableAbstractDetail();
                break;
        }
    }
}
```

### Performance Management

**Limiting Detailed NPCs**:
- Maximum number of detailed NPCs at once
- Prioritize favoritism NPCs
- Transition others to abstract when limit reached

**Implementation**:
```javascript
class PerformanceManager {
    constructor(maxDetailedNPCs = 50) {
        this.maxDetailedNPCs = maxDetailedNPCs;
        this.detailedNPCs = new Set();
    }
    
    requestDetail(npc) {
        // Check if we can add more detailed NPCs
        if (this.detailedNPCs.size >= this.maxDetailedNPCs) {
            // Transition least important NPC to abstract
            const leastImportant = this.findLeastImportantDetailedNPC();
            this.transitionToAbstract(leastImportant);
        }
        
        // Add NPC to detailed set
        this.detailedNPCs.add(npc.id);
        this.transitionToDetailed(npc);
    }
    
    findLeastImportantDetailedNPC() {
        // Find NPC with lowest favoritism that's not selected
        let leastImportant = null;
        let lowestFavoritism = Infinity;
        
        for (const npcId of this.detailedNPCs) {
            const npc = this.getNPC(npcId);
            if (!npc.isSelected && npc.favoritismPoints < lowestFavoritism) {
                leastImportant = npc;
                lowestFavoritism = npc.favoritismPoints;
            }
        }
        
        return leastImportant;
    }
}
```

## Performance Optimization

### Spatial Partitioning

**Grid-Based Partitioning**:
- Divide space into grid cells
- Only process NPCs in same/adjacent cells
- Reduces pathfinding and collision checks

**Implementation**:
```javascript
class NPCSpatialGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }
    
    insert(npc) {
        const cellKey = this.getCellKey(npc.position);
        if (!this.grid.has(cellKey)) {
            this.grid.set(cellKey, []);
        }
        this.grid.get(cellKey).push(npc);
    }
    
    query(position, radius) {
        const nearbyNPCs = [];
        const cells = this.getCellsInRadius(position, radius);
        
        for (const cellKey of cells) {
            const npcs = this.grid.get(cellKey) || [];
            nearbyNPCs.push(...npcs);
        }
        
        return nearbyNPCs;
    }
}
```

### Path Caching

**Cache Paths**:
- Cache frequently used paths
- Invalidate on infrastructure changes
- Reduce redundant pathfinding calculations

**Implementation**:
```javascript
class PathCache {
    constructor(maxCacheSize = 1000) {
        this.cache = new Map();
        this.maxCacheSize = maxCacheSize;
    }
    
    getPath(start, end) {
        const key = this.getCacheKey(start, end);
        
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        
        // Calculate path
        const path = this.calculatePath(start, end);
        
        // Cache if not too large
        if (this.cache.size < this.maxCacheSize) {
            this.cache.set(key, path);
        }
        
        return path;
    }
    
    invalidateCache(zone) {
        // Remove paths involving this zone
        for (const [key, path] of this.cache.entries()) {
            if (path.includes(zone)) {
                this.cache.delete(key);
            }
        }
    }
}
```

### Abstract Mass Optimization

**Batch Processing**:
- Process abstract NPCs in batches
- Reduce individual update calls
- Aggregate pathfinding

**Implementation**:
```javascript
class AbstractMassManager {
    update(dt) {
        // Process abstract NPCs in batches
        const batchSize = 100;
        const batches = this.chunkArray(this.abstractNPCs, batchSize);
        
        for (const batch of batches) {
            // Process batch in parallel (if possible)
            for (const npcMass of batch) {
                npcMass.update(dt);
            }
        }
    }
    
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
```

### Hierarchical Pathfinding

**Multi-Level Pathfinding**:
- High-level: Zone-to-zone
- Mid-level: Transportation network
- Low-level: Precise paths

**Implementation**:
```javascript
class HierarchicalPathfinder {
    findPath(start, end) {
        // High-level: Zone path
        const zonePath = this.findZonePath(start.zone, end.zone);
        
        // Mid-level: Transportation path for each zone transition
        const transportPaths = [];
        for (let i = 0; i < zonePath.length - 1; i++) {
            const transportPath = this.findTransportationPath(
                zonePath[i],
                zonePath[i + 1]
            );
            transportPaths.push(transportPath);
        }
        
        // Low-level: Precise path (only for detailed NPCs)
        if (this.requiresPrecisePath) {
            return this.refinePath(transportPaths);
        }
        
        return transportPaths;
    }
}
```

## Implementation Phases

### Phase 1: Basic Pathfinding
- A* algorithm implementation
- Zone-level pathfinding
- Basic transportation network

### Phase 2: Multi-Modal Transportation
- Transportation network pathfinding
- Mode selection and transitions
- Hybrid pathfinding

### Phase 3: NPC Decision Making
- Needs-based decisions
- Behavior trees
- Abstract vs detailed decision making

### Phase 4: Favoritism System
- Favoritism tracking
- Detail scaling
- Performance management

### Phase 5: Performance Optimization
- Spatial partitioning
- Path caching
- Abstract mass optimization
- Hierarchical pathfinding

## Open Questions

1. How many detailed NPCs can we support simultaneously?
2. Should we use hierarchical pathfinding or single-level A*?
3. How detailed should abstract mass relationships be?
4. Should favoritism decay over time?

## Future Considerations

- Machine learning for NPC behavior
- More sophisticated relationship modeling
- Dynamic behavior tree generation
- Advanced pathfinding (jump point search, etc.)
- NPC group behaviors and formations
- Emotional state modeling

