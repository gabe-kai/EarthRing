# Game Mechanics

## Table of Contents

- [Overview](#overview)
- [City Builder Mechanics](#city-builder-mechanics)
  - [Structure Placement](#structure-placement)
  - [Resource Management](#resource-management)
  - [Zone Management](#zone-management)
  - [City Growth and Development](#city-growth-and-development)
- [Light Sims Elements](#light-sims-elements)
  - [NPC System](#npc-system)
  - [NPC Population Management](#npc-population-management)
  - [NPC Visualization and Selection](#npc-visualization-and-selection)
- [Racing Mechanics](#racing-mechanics)
  - [Illegal City Racing (Microgravity Sports)](#illegal-city-racing-microgravity-sports)
  - [Race Route Generation](#race-route-generation)
  - [Vehicle and Movement System](#vehicle-and-movement-system)
  - [Racing Modes](#racing-modes)
  - [Physics and Gameplay](#physics-and-gameplay)
  - [Integration with City Builder](#integration-with-city-builder)
- [Multi-Genre Integration](#multi-genre-integration)
  - [Seamless Transitions](#seamless-transitions)
  - [Cross-Genre Effects](#cross-genre-effects)
- [Progression Systems](#progression-systems)
  - [Player Progression](#player-progression)
  - [Economic Progression](#economic-progression)
  - [Social Progression](#social-progression)
- [Law Enforcement and Consequences](#law-enforcement-and-consequences)
  - [Law Enforcement System](#law-enforcement-system)
  - [Consequences System](#consequences-system)
  - [Reputation Factions](#reputation-factions)
- [Time System](#time-system)
  - [Continuous World Time](#continuous-world-time)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

EarthRing combines three game genres: city builder, light Sims elements, and racing. Players build and manage cities on an orbital ring, watch NPCs live their lives, and race through the cities they've created.

## City Builder Mechanics

### Structure Placement

#### Player-Placed Structures

Players can place structures directly:

1. **Building Types**
   - Residential buildings (apartments, houses)
   - Commercial buildings (shops, restaurants, offices)
   - Industrial buildings (factories, warehouses)
   - Infrastructure (power, water, waste management)
   - Decorative elements (parks, monuments, decorations)

2. **Placement Rules**
   - Must be within valid zone (if zone restrictions apply)
   - Cannot overlap other structures
   - Must respect height limits
   - Must have access to roads (for functional buildings)

3. **Structure Properties**
   - Size and dimensions
   - Functionality (what it does)
   - Resource production/consumption
   - NPC capacity (how many NPCs it supports)
   - Cost and maintenance

#### Procedural Generation

Structures generate automatically based on zones:

1. **Zone-Based Generation**
   - Residential zones generate housing
   - Commercial zones generate shops
   - Industrial zones generate factories
   - Density affects building size and number

2. **Generation Rules**
   - Respects zone boundaries
   - Avoids player-placed structures
   - Follows zone style and density
   - Generates over time (city growth)

3. **Player Influence**
   - Players can zone areas to guide generation
   - Players can place key structures
   - Players can modify zone properties

### Resource Management

#### Resources

Cities require and produce various resources:

1. **Basic Resources**
   - **Power**: Required for most buildings
   - **Water**: Required for residential and commercial
   - **Waste Management**: Required for all zones
   - **Transportation**: Required for NPC movement

2. **Economic Resources**
   - **Currency**: Earned from commercial/industrial zones
   - **Materials**: Produced by industrial zones
   - **Food**: Produced/consumed by various zones

3. **Social Resources**
   - **Happiness**: Affected by zone quality, parks, services
   - **Education**: Provided by schools/universities
   - **Healthcare**: Provided by medical facilities

#### Resource Flow

1. **Production**
   - Industrial zones produce materials
   - Commercial zones produce currency
   - Services produce social resources

2. **Consumption**
   - Buildings consume power, water, waste capacity
   - NPCs consume food, services
   - Maintenance consumes currency

3. **Distribution**
   - Resources flow through road network
   - Maglev transports resources long distances
   - Infrastructure required for distribution

### Zone Management

Players define and manage zones (see Zone System Design doc):

1. **Zone Creation**
   - Draw freeform polygons
   - Assign zone types
   - Set properties (density, style, etc.)

2. **Zone Effects**
   - Zones control what can be built
   - Zones affect NPC behavior
   - Zones influence procedural generation

3. **Zone Optimization**
   - Balance zone types
   - Optimize resource flow
   - Maximize NPC happiness

### City Growth and Development

1. **Population Growth**
   - NPCs move in as city develops
   - Attraction based on available housing, jobs, services
   - Population affects resource demands

2. **Economic Growth**
   - More zones = more economic activity
   - Better infrastructure = higher efficiency
   - Player investments = long-term returns

3. **Expansion**
   - Players expand zones over time
   - New areas develop as infrastructure extends
   - Procedural generation fills in details

## Light Sims Elements

### NPC System

#### NPC Complexity Model

**Design Philosophy**: NPCs are as complex as the system can handle, but modeled efficiently to support large populations. NPCs live autonomously unless a player decides to select and control one.

**Two-Tier NPC System**:

1. **Abstract Mass NPCs** (Default State)
   - NPCs modeled in aggregate for performance optimization
   - Basic needs and behaviors simulated at population level
   - Relationships tracked abstractly (e.g., "NPC group A frequents business B")
   - Minimal individual detail until selected
   - Allows large populations with good performance
   - Still maintain basic autonomy and routines
   - Contribute to traffic patterns and city dynamics

2. **Detailed Individual NPCs** (When Selected)
   - When a player selects an NPC, it transitions from abstract to fully detailed
   - Gains full complexity, personality, and thorough history
   - Individual relationships become explicit and detailed
   - Full Sims-like needs and behaviors activated
   - Can be controlled by player (if player chooses)
   - History includes:
     - Past relationships with other NPCs
     - Businesses frequented and preferences
     - Events attended and participated in
     - Personal milestones and experiences
   - Personality traits become active and influence behavior
   - Individual quirks and habits manifest

**Autonomous Operation**:
- NPCs live autonomously unless player selects and controls one
- Even when selected, NPC can continue autonomously if player doesn't take control
- Selected NPCs maintain their relationships and routines
- Player can observe detailed NPC behavior when selected
- Autonomous NPCs continue to evolve relationships and behaviors even when not selected
- Abstract NPCs maintain relationship data that can be expanded when selected

**Performance Considerations**:
- Abstract modeling allows thousands of NPCs with minimal performance impact
- Detailed NPCs are computationally expensive, so limited number can be detailed at once
- System automatically manages transition between abstract and detailed states
- Relationship data preserved when transitioning between states

#### NPC Types

1. **Residents**
   - Live in residential zones
   - Have homes, families, daily routines
   - Commute to work, shop, recreate
   - Maintain relationships with neighbors, family, businesses

2. **Workers**
   - Work in commercial/industrial zones
   - Commute from residential zones
   - Have work schedules
   - Maintain relationships with coworkers, employers, customers

3. **Visitors**
   - Temporary NPCs
   - Visit commercial zones, parks
   - Leave after activities
   - May become residents if they like the area

#### NPC Needs (Sims-like)

NPCs have needs that affect behavior. Complexity increases when selected:

1. **Basic Needs** (All NPCs)
   - **Housing**: Need a home in residential zone
   - **Work**: Need employment in commercial/industrial zone
   - **Food**: Need access to food sources
   - **Transportation**: Need roads/maglev to move

2. **Quality of Life** (All NPCs)
   - **Happiness**: Affected by zone quality, services, parks
   - **Education**: Access to schools improves NPCs
   - **Healthcare**: Medical facilities improve health
   - **Entertainment**: Commercial zones, parks provide recreation

3. **Social Needs** (All NPCs)
   - **Community**: NPCs prefer areas with other NPCs
   - **Services**: Access to shops, restaurants, etc.
   - **Safety**: Well-lit, policed areas preferred

4. **Relationships** (Detailed when selected)
   - **With Other NPCs**: Friends, family, coworkers, neighbors
   - **With Businesses**: Regular customers, preferred shops, favorite restaurants
   - **Relationship History**: Past interactions, events, conflicts
   - **Relationship Strength**: How close NPCs are to each other/businesses
   - **Social Network**: Who knows whom, influence networks

5. **Personality** (Detailed when selected)
   - Personality traits affect behavior and preferences
   - Individual quirks and habits
   - Personal history and backstory
   - Goals and aspirations

#### NPC Behavior

1. **Daily Routines** (All NPCs)
   - Wake up, go to work, return home
   - Shop, eat, recreate
   - Sleep schedule
   - Routines adapt based on relationships and preferences (detailed when selected)

2. **Pathfinding**
   - NPCs navigate road network
   - Use maglev for long distances
   - Avoid congestion when possible
   - Selected NPCs show detailed pathfinding decisions

3. **Decision Making** (Abstract → Detailed)
   - **Abstract**: Choose homes/work based on aggregate factors (quality, price, proximity)
   - **Detailed (when selected)**: Individual preferences, relationship influences, personal history affect decisions
   - Visit commercial zones based on needs and relationships
   - Selected NPCs show reasoning behind decisions

4. **Traffic Generation**
   - NPC movement creates traffic patterns
   - Traffic density affects road generation
   - High traffic = need for better roads
   - Abstract NPCs contribute to traffic patterns

5. **Relationship Maintenance** (Detailed when selected)
   - NPCs maintain relationships with frequented businesses
   - Regular customers develop preferences
   - Social relationships evolve over time
   - Relationship history affects future behavior

### NPC Population Management

1. **Population Growth**
   - NPCs spawn as city develops
   - Attraction based on available housing/jobs
   - Population stabilizes based on capacity

2. **Population Distribution**
   - NPCs distribute across residential zones
   - Workers distribute across work zones
   - Visitors appear in commercial zones

3. **Population Dynamics**
   - NPCs move if needs not met
   - Population changes affect zone viability
   - Player actions influence NPC behavior

### NPC Visualization and Selection

1. **Rendering**
   - Render NPCs in 3D world
   - Show NPCs going about daily routines
   - Indicate NPC needs/status visually
   - Abstract NPCs rendered as generic avatars
   - Selected NPCs show detailed appearance and personality

2. **NPC Selection**
   - Players can click NPCs to select them
   - Selection triggers detailed NPC generation:
     - Full personality and history generated
     - Relationships become explicit
     - Individual needs and preferences detailed
     - Past interactions with businesses and other NPCs revealed
   - Selected NPC can be observed in detail or controlled by player
   - **Single Control Limit**: Players can only directly control one NPC at a time
   - Previously selected NPCs gain favoritism points (see NPC Favoritism System)

3. **Player Control of NPCs**
   - **Direct Control**: Player can take direct control of selected NPC
   - **Single NPC Limit**: Only one NPC can be controlled at a time
   - **Lingering Effects**: NPCs retain memories of actions taken while controlled
     - NPCs develop preferences for activities done while controlled
     - NPCs may seek out similar activities autonomously
     - Creates lasting impact on NPC behavior
   - **Autonomous Fallback**: If player doesn't control, NPC continues autonomously
   - **Control Detection**: Law enforcement can detect if NPC was controlled (see Law Enforcement section)

4. **NPC Favoritism and Tracking System**
   - **Favoritism Points**: NPCs gain favoritism points each time they are selected
   - **Enhanced Attention**: Previously controlled NPCs receive more system attention
   - **Detailed Modeling**: NPCs with favoritism points get more detailed modeling than abstract NPCs
   - **Tracking**: System tracks which NPCs have been selected/controlled
   - **Persistent Detail**: Frequently selected NPCs maintain more detail even when not selected
   - **Performance Balance**: System manages favoritism NPCs efficiently while maintaining performance

5. **Interaction**
   - Players can observe NPCs (abstract or detailed)
   - Players can click NPCs for info (abstract → detailed on selection)
   - NPCs react to player structures
   - Selected NPCs show detailed reactions and thoughts
   - Previously controlled NPCs show recognition of player

## Racing Mechanics

### Illegal City Racing (Microgravity Sports)

Racing in EarthRing is **illegal city racing** that uses existing transportation infrastructure and takes advantage of the microgravity environment. There are no official race tracks or dedicated racing infrastructure - players race through the city using whatever infrastructure exists, often in ways it wasn't intended for.

**Microgravity Environment**: The orbital ring is in microgravity, making traditional ground vehicles impractical. Racing focuses on **precise velocity control** rather than traditional driving skills. Players must master momentum, trajectory, and microgravity physics.

### Race Route Generation

Race routes are created from existing city infrastructure:

1. **Route Selection**
   - Players select start and end points (or checkpoints)
   - System generates route using existing transportation network
   - Routes can use any transportation infrastructure:
     - Road lanes (at hubs)
     - Tram-loops
     - Conveyor sidewalks
     - Bike/skate lanes
     - Even foot traffic areas (challenging!)

2. **Dynamic Route Generation**
   - Routes adapt to city layout
   - Use A* pathfinding through transportation network
   - Can include multiple checkpoints
   - Routes change as city infrastructure evolves

3. **Route Properties**
   - Length and complexity based on city layout
   - Difficulty varies with infrastructure type
   - Obstacles: NPCs, other traffic, city structures
   - Scenery: The city itself provides the backdrop

### Vehicle and Movement System

**Note**: Electric power is assumed for all vehicles (enclosed orbital environment).

1. **Movement Types**
   - **Parkour** (Primary Sport): 
     - Jumping off walls and structures to gain momentum
     - Moving through places you aren't supposed to be
     - Requires precise velocity control and trajectory planning
     - Core skill for microgravity racing
   
   - **Drone Hitching**: 
     - Hitching rides on delivery and maintenance drones
     - Jumping off emergency vehicles mid-flight
     - Popular sport that lands kids in jail overnight
     - Requires timing and precision
   
   - **Maglev Skateboards**: 
     - Vehicle of mischief
     - Ride maglev infrastructure (tracks, loops)
     - Fast, agile, perfect for microgravity racing
     - Can be customized and tuned
   
   - **Hydrogen Jetpacks**: 
     - Personal propulsion system
     - Precise velocity control
     - Limited fuel requires strategic use
     - High skill ceiling
   
   - **Maglev Vehicles** (Stolen/Hacked):
     - Most maglev vehicles have strict governors (speed limiters)
     - "Borrowed" (stolen) vehicles are common
     - Hacked vehicles remove governors for illegal racing
     - **Vehicle Hacking**: Severe crime with massive consequences (see Law Enforcement section)
     - Various sizes: personal pods, cargo carriers, maintenance vehicles
     - Risk of getting caught increases with vehicle size

2. **Vehicle Properties**
   - **Velocity Control**: Primary skill - managing speed and direction in microgravity
   - **Momentum Management**: Understanding inertia and trajectory
   - **Fuel/Energy**: Limited resources require strategic use
   - **Durability**: Collisions and crashes cause damage
   - **Governor Status**: Whether speed limiters are active or hacked

3. **Vehicle Customization**
   - Visual customization (paint, decals, modifications)
   - Performance tuning (thrust, handling, fuel efficiency)
   - Governor removal/hacking (illegal modification)
   - Upgrade system for legal vehicles

### Racing Modes

1. **Time Trial** (Illegal Street Racing)
   - Race against clock on city routes
   - Best time leaderboards
   - Solo racing through city using parkour, vehicles, or both
   - Avoid NPCs, traffic, and security
   - Master precise velocity control

2. **Multiplayer Racing** (Illegal Street Racing)
   - Race against other players
   - Real-time multiplayer through city
   - Matchmaking system
   - Routes through existing infrastructure
   - NPCs, traffic, and security create dynamic obstacles
   - Players can interfere with each other (illegal racing - anything goes)

3. **Championship** (Illegal Racing Series)
   - Series of races through different city areas
   - Points system
   - Routes change as city evolves
   - No official tracks - all city infrastructure
   - Mix of parkour, vehicle, and hybrid challenges

### Physics and Gameplay

1. **Microgravity Physics** (Realistic Physics Model)

   **Design Decision**: Microgravity physics are realistic rather than arcade-style, requiring players to master actual physics principles.

   - **Velocity Control**: Primary skill - managing speed and direction precisely
     - No artificial speed limits or constraints
     - Velocity persists until acted upon by forces
     - Precise thrust control required for maneuvering
   
   - **Momentum Conservation**: Once moving, hard to stop without thrust/braking
     - Realistic inertia - objects maintain velocity in microgravity
     - Requires equal and opposite forces to change direction
     - Momentum transfers realistically in collisions
   
   - **Trajectory Planning**: Must plan paths accounting for microgravity arcs
     - Objects follow realistic ballistic trajectories
     - No artificial path correction or "magnetic" attraction to surfaces
     - Must account for gravity gradients and orbital mechanics
     - Requires understanding of velocity vectors and acceleration
   
   - **Wall Kicks**: Using walls and structures to change direction and gain speed
     - Realistic collision physics - angle of incidence equals angle of reflection (with energy loss)
     - Must time impacts precisely for desired trajectory changes
     - Energy loss on impact affects subsequent velocity
   
   - **Collision Detection**: Realistic physics for impacts
     - Realistic collision response based on mass, velocity, and material properties
     - Energy conservation (with losses) in collisions
     - Impulse-based physics for realistic force application
   
   - **Damage System**: Crashes cause damage to player, vehicle, and objects/NPCs crashed into
     - Damage scales realistically with impact energy (kinetic energy = ½mv²)
     - Structural integrity affects damage propagation
     - Realistic material deformation and failure
   
   - **Gravity Gradients**: 
     - Ring structure creates subtle gravity gradients
     - Centrifugal forces from ring rotation affect movement
     - Coriolis effects may be noticeable at high speeds
   
   - **Atmospheric Effects** (if applicable):
     - Air resistance in pressurized areas
     - Drag forces proportional to velocity squared
     - Turbulence and air currents affect movement
   
   - **No Arcade Simplifications**:
     - No auto-stabilization or auto-correction
     - No "sticky" surfaces or artificial attraction
     - No simplified collision responses
     - No unrealistic speed boosts or power-ups
     - Physics are consistent and predictable based on real-world principles

2. **Racing Damage System**
   - **Player Damage**: 
     - Crashes can injure or kill the player character
     - Damage scales with impact velocity and collision type
     - Severe injuries require medical attention or respawn
     - Death results in respawn with consequences
   
   - **Vehicle Damage**:
     - Vehicles take damage from crashes
     - Damage affects performance (handling, speed, control)
     - Severe damage can disable vehicle
     - Vehicles require repair or replacement
   
   - **Collision Damage**:
     - Crashes damage structures, infrastructure, and objects
     - NPCs can be injured or killed in collisions
     - Damage to city infrastructure requires repair
     - Property damage has financial consequences
   
   - **Proportional Consequences**:
     - Consequences scale with damage caused
     - Killing NPCs = severe consequences (see Law Enforcement section)
     - Property damage = fines proportional to repair costs
     - Player injury/death = time loss, medical costs
     - Vehicle damage = repair/replacement costs

3. **Infrastructure Interaction**
   - Different infrastructure types affect movement:
     - **Maglev Tracks**: Smooth, fast, but monitored - risk of detection
     - **Tram-loops**: Can ride on top or alongside, predictable surface
     - **Conveyor Sidewalks**: Unique surface properties, can use for speed boosts
     - **Bike/Skate Lanes**: Narrow, technical, good for parkour
     - **Foot Traffic Areas**: Challenging, unpredictable NPC movement
     - **Walls and Structures**: Parkour surfaces - jump off for momentum
     - **Drones**: Can hitch rides, timing critical
     - **Emergency Vehicles**: Fast but risky - high security
   - Elevation changes affect trajectory (microgravity arcs)
   - NPCs and traffic create dynamic obstacles
   - City structures create natural parkour routes and challenges
   - Security systems can detect illegal activity

3. **Racing Rules** (Illegal Street Racing)
   - Checkpoints required (must pass through)
   - Finish line crossing
   - No penalties for shortcuts (illegal racing - anything goes)
   - Avoid NPCs, traffic, and security (creates challenge)
   - Routes adapt to city changes
   - **Velocity Control Challenge**: Precise speed management is key skill
   - **Movement Type Freedom**: Can use parkour, vehicles, or combination
   - **Risk vs Reward**: Faster routes often riskier (security, crashes)
   - **Collision Consequences**: Crashes can kill NPCs and cause severe damage (see Racing Damage System)

### Integration with City Builder

1. **City as Race Track**
   - Players race through their cities using existing infrastructure
   - City layout directly affects race difficulty and route options
   - Transportation infrastructure choices create different racing experiences:
     - Narrow bike lanes = technical parkour routes
     - Maglev tracks = high-speed sections (if you can avoid detection)
     - Tram-loops = medium-speed, predictable surfaces
     - Conveyor sidewalks = unique racing surface with speed boosts
     - Tall structures = parkour opportunities (wall kicks, jumps)
     - Dense areas = challenging navigation, more obstacles
   - Players can influence racing by how they design their city
   - Microgravity means vertical space is as important as horizontal

2. **No Racing Infrastructure**
   - No dedicated racing structures (starting grids, pit stops, etc.)
   - Racing uses existing city infrastructure
   - Players meet at informal locations (hubs, stations, landmarks, hidden spots)
   - Racing is illegal, so no official support structures
   - Security systems can detect and respond to illegal racing
   - Law enforcement investigates crashes and illegal activity (see Law Enforcement section)

3. **Racing Events** (Illegal Street Racing)
   - Players can organize illegal street racing events
   - Other players can participate
   - Events use existing city routes
   - No official sanctioning - underground racing culture
   - Events can be parkour-only, vehicle-only, or hybrid
   - Risk of security intervention adds excitement

## Multi-Genre Integration

### Seamless Transitions

1. **Mode Switching**
   - Switch between city builder and racing
   - Same world, different gameplay
   - Shared progress and structures

2. **Unified Progression**
   - Building city unlocks racing features
   - Racing success rewards city building
   - Shared currency and resources

### Cross-Genre Effects

1. **City Building → Racing**
   - Better roads = better racing
   - City layout affects track quality
   - Infrastructure supports racing events

2. **Racing → City Building**
   - Racing events attract NPCs (spectators, participants)
   - City design that enables good racing becomes popular
   - Racing success provides resources (winnings, reputation)
   - Illegal racing culture influences city character

3. **NPCs → Both**
   - NPCs use roads (affects racing)
   - NPCs populate city (affects building)
   - NPCs attend racing events

## Progression Systems

### Player Progression

1. **Level System**
   - Gain experience from actions
   - Level up unlocks new features
   - Higher levels = more capabilities

2. **Unlock System**
   - Unlock new building types
   - Unlock new zone types
   - Unlock racing features

3. **Achievement System**
   - Achievements for milestones
   - City size achievements
   - Racing achievements
   - Combined achievements

### Economic Progression

1. **Currency System**
   - Earn currency from zones
   - Spend on structures and upgrades
   - Invest in city development

2. **Resource Progression**
   - Unlock new resources
   - Improve resource efficiency
   - Expand resource production

### Social Progression

1. **Multiplayer Features**
   - Visit other players' cities
   - Race on other players' tracks
   - Collaborate on city building

2. **Leaderboards**
   - City size leaderboards
   - Racing time leaderboards
   - Combined leaderboards

## Law Enforcement and Consequences

### Law Enforcement System

**Overview**: Law enforcement actively monitors and responds to illegal racing, vehicle theft/hacking, and other crimes. The system includes detection, investigation, and proportional consequences.

#### Detection and Investigation

1. **Crime Detection**
   - Security systems monitor maglev infrastructure and public areas
   - Illegal racing detected through speed violations, unauthorized vehicle use
   - Vehicle theft/hacking detected through unauthorized access
   - Collisions and property damage trigger investigations
   - NPC deaths trigger mandatory investigations

2. **NPC Control Detection**
   - Law enforcement can check if an NPC was being influenced or controlled by a human player
   - Investigation reveals control history and patterns
   - **Leniency for Uncontrolled NPCs**: NPCs not controlled by players receive lenient treatment
     - Uncontrolled NPCs treated as victims or unwitting participants
     - Reduced or no consequences for uncontrolled NPCs
   - **Monitoring Frequently Controlled NPCs**: NPCs frequently controlled by players are watched
     - Authorities track NPCs with high control frequency
     - Increased surveillance and suspicion
     - May be questioned or detained for investigation

3. **Investigation Process**
   - Authorities investigate crashes, property damage, and illegal activity
   - Review control logs and NPC behavior patterns
   - Determine if NPCs were controlled or acting autonomously
   - Assess damage and assign responsibility

#### Consequences System

**Proportional Consequences**: All consequences scale with the severity of damage and crimes committed.

1. **Jail Time**
   - Temporary imprisonment for crimes
   - Duration scales with severity:
     - Minor violations: Hours to days
     - Property damage: Days to weeks
     - NPC injury: Weeks to months
     - NPC death: Months to years
     - Vehicle hacking: Severe sentences (see below)
   - Jail time prevents player actions during sentence
   - Can be reduced with good behavior or reputation

2. **Fines**
   - Financial penalties for crimes and damage
   - Scales proportionally with:
     - Property damage repair costs
     - Medical costs for injured NPCs
     - Infrastructure repair costs
     - Value of stolen/hacked vehicles
   - Must be paid before release from jail
   - Unpaid fines accumulate interest

3. **Reputation System**
   - Reputation with different factions affected by actions
   - **Law Enforcement Reputation**:
     - Decreases with illegal activity
     - Decreases significantly with vehicle hacking
     - Decreases with NPC deaths and property damage
     - Increases with lawful behavior
     - Low reputation = increased surveillance and harsher penalties
   
   - **Criminal Faction Reputation**:
     - Increases with illegal racing and crimes
     - Increases significantly with vehicle hacking
     - Increases with successful evasion of law enforcement
     - High reputation = access to criminal networks and resources
     - Low reputation = isolation from criminal activities
   
   - **Civilian Reputation**:
     - Decreases with NPC deaths and property damage
     - Affects NPC interactions and business access
     - Low reputation = NPCs avoid player, businesses refuse service

4. **Vehicle Hacking Consequences** (Severe Crime)
   - **Massive Law Enforcement Reputation Loss**: Vehicle hacking is considered a severe crime
     - Large negative impact on law enforcement reputation
     - Authorities prioritize catching vehicle hackers
     - Increased surveillance and investigation
     - Harsher penalties for all future crimes
   
   - **Significant Criminal Faction Reputation Gain**: Vehicle hacking earns respect in criminal circles
     - Large positive impact on criminal faction reputation
     - Access to criminal networks and resources
     - Recognition as skilled hacker
     - Opportunities for criminal activities
   
   - **Severe Legal Consequences**:
     - Long jail sentences (months to years)
     - Massive fines
     - Permanent criminal record
     - Ongoing surveillance after release

5. **NPC Death Consequences**
   - **Severe Penalties**: Killing NPCs has the most severe consequences
   - Long jail sentences
   - Massive fines (compensation to families)
   - Severe reputation loss with all factions
   - Mandatory investigation
   - May result in permanent criminal status

6. **Property Damage Consequences**
   - Fines proportional to repair costs
   - Reputation loss with property owners
   - May require community service
   - Repeat offenders face harsher penalties

#### Reputation Factions

1. **Law Enforcement**
   - Authorities, security forces, legal system
   - High reputation = leniency, reduced penalties, access to legal resources
   - Low reputation = harsh penalties, increased surveillance

2. **Criminal Factions**
   - Underground networks, illegal racing groups, hackers
   - High reputation = access to criminal resources, protection, opportunities
   - Low reputation = isolation, no access to criminal activities

3. **Civilian Population**
   - General NPCs, businesses, communities
   - High reputation = friendly NPCs, business access, community support
   - Low reputation = NPCs avoid player, businesses refuse service, social isolation

## Time System

### Continuous World Time

**Design Decision**: Players cannot pause or affect time - the world keeps going regardless of what players do. The world operates on a continuous timeline that never stops.

**Core Principles**:
- **No Time Control**: Players have no ability to pause, slow down, speed up, or otherwise manipulate time
- **Continuous Progression**: World time progresses continuously, even when players are offline
- **Real-Time Consequences**: All actions happen in real-time relative to the world clock
- **Living World**: The world operates independently of player presence

**Implementation Details**:

1. **World Clock**
   - Single authoritative world time maintained by server
   - Continuous progression regardless of player actions
   - Synchronized across all clients
   - Events scheduled based on world time

2. **NPC Behavior**
   - NPCs continue their routines regardless of player actions
   - Daily cycles, work schedules, and events proceed on schedule
   - NPCs age, relationships evolve, businesses operate continuously
   - Autonomous behavior independent of player observation

3. **City Evolution**
   - City continues to grow and evolve based on existing conditions
   - Procedural generation continues
   - Infrastructure adapts to traffic patterns
   - Zones develop and change over time

4. **Events and Activities**
   - Events happen on schedule based on world time
   - Racing events occur at scheduled times
   - NPC activities proceed regardless of player presence
   - City-wide events and activities continue autonomously

5. **Player Impact**
   - Players must manage their activities in real-time
   - Cannot pause to plan or think
   - Must prioritize activities based on time constraints
   - Actions have immediate and ongoing consequences

**Benefits**:
- **Immersive Experience**: World feels alive and dynamic
- **Autonomous NPCs**: NPCs feel more real and independent
- **Strategic Planning**: Forces players to think ahead and prioritize
- **Living World**: Creates sense of persistent, evolving world
- **Real Consequences**: Actions matter because time cannot be rewound

**Challenges and Solutions**:
- **Missing Events**: Players may miss events if not present
  - Solution: Notification systems for important events
  - Solution: Event history and replay features
- **Time Management**: Requires careful planning
  - Solution: Calendar and scheduling tools
  - Solution: Reminder systems for important activities
- **Offline Progression**: World continues when players are offline
  - Solution: Summary reports of what happened while away
  - Solution: Ability to review changes and catch up

**Integration with Other Systems**:
- NPC routines synchronized with world time
- Racing events scheduled based on world clock
- City building activities happen in real-time
- Resource production and consumption tied to world time
- All game systems operate relative to continuous world time

## Open Questions

1. How do we balance city building resources with racing rewards?
2. Should there be different parkour skill levels/abilities?

## Future Considerations

- More detailed NPC relationships and families
- Advanced vehicle customization and tuning
- Player-created content (custom buildings, vehicles)
- Seasonal events and challenges
- Advanced city management tools (budgets, policies)
- VR support for immersive city viewing and racing

