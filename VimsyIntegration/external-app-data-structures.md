# External App Data Import - Data Structures Reference

## Vimsy Day Record Structure

Each day in Vimsy has the following arrays for different data types:

```javascript
{
  DATE: "2026-04-15",
  items: [],                    // Food items (meals)
  fitnessActivities: [],        // Fitness activities
  mindActivities: [],           // Mind/cognitive activities
  sleepEvents: [],              // Sleep tracking
  bodyMeasurements: [],         // Body measurements (weight, body fat, etc.)
  discomfortEvents: [],         // Discomfort/pain tracking
  labTests: [],                 // Lab test results
  notes: "",                    // Day notes
  // ... other fields
}
```

---

## 1. Mind Activities

### Registry
- **Source**: `MIND_REGISTRY` in `Vimsy-registries.js`
- **Field in day**: `mindActivities`
- **ID field**: `activityId`

### Item Structure
```javascript
{
  activityId: 2,        // Required: ID from MIND_REGISTRY
  duration: 30,         // Optional: minutes
  notes: "text"         // Optional: free text
}
```

### Common Activity IDs
- **2**: Chess, puzzles
- **3**: Chess, competitive
- **4**: Bridge, competitive
- **5**: Poker, competitive
- **6**: Playing learned music on instrument
- **7**: Learning new music on instrument
- **8**: Solving puzzles, jigsaw
- **9**: Solving puzzles, crossword
- **10**: Solving puzzles, sudoku
- **11**: Solving puzzles, word search
- **13**: Visual arts
- **14**: Reading, fiction
- **15**: Reading, non-fiction
- **16**: Learning a language
- **17**: Meditation
- **18**: Writing
- **20**: Socializing with friends
- **21**: Community engagement

---

## 2. Fitness Activities

### Registry
- **Source**: `ACTIVITIES_REGISTRY` in `Vimsy-registries.js`
- **Field in day**: `fitnessActivities`
- **ID field**: `activityId`

### Item Structure
```javascript
{
  activityId: 10,       // Required: ID from ACTIVITIES_REGISTRY
  duration: 45,         // Optional: minutes
  intensity: "moderate",// Optional: light|moderate|vigorous
  notes: "text"         // Optional: free text
}
```

### Common Activity IDs
- **1**: Walking, slowly (<2 mph)
- **2**: Walking, 2.5 mph
- **3**: Walking, 3.0 mph
- **4**: Walking, 3.5 mph
- **5**: Walking, uphill
- **10**: Running, 5 mph (12 min/mile)
- **11**: Running, 6 mph (10 min/mile)
- **12**: Running, 7 mph (8.5 min/mile)
- **20**: Cycling, leisure (<10 mph)
- **21**: Cycling, 10-12 mph
- **22**: Cycling, 12-14 mph
- **30**: Weight lifting, light/moderate
- **31**: Weight lifting, vigorous
- **40**: Yoga, hatha
- **41**: Yoga, vinyasa/flow
- **50**: Swimming, leisurely
- **51**: Swimming, laps, moderate
- **60**: Basketball, game
- **70**: Tennis, singles

---

## 3. Body Measurements

### Registry
- **Source**: `BODY_REGISTRY` in `Vimsy-registries.js`
- **Field in day**: `bodyMeasurements`
- **ID field**: `bodyId`

### Item Structure
```javascript
{
  bodyId: 1,            // Required: ID from BODY_REGISTRY
  value: 175.5,         // Required: measurement value
  notes: "text"         // Optional: free text
}
```

### Common Body IDs
- **1**: Weight (lbs or kg)
- **2**: Body Fat %
- **3**: Muscle Mass %
- **4**: BMI
- **5**: Waist Circumference
- **6**: Hip Circumference
- **7**: Chest Circumference
- **8**: Arm Circumference
- **9**: Thigh Circumference
- **10**: Neck Circumference
- **11**: Body Water %
- **12**: Bone Mass
- **13**: Visceral Fat Rating
- **14**: Metabolic Age
- **15**: Basal Metabolic Rate (BMR)

---

## 4. Sleep Events

### Registry
- **Source**: `SLEEP_REGISTRY` in `Vimsy-registries.js`
- **Field in day**: `sleepEvents`
- **ID field**: `sleepId`

### Item Structure (varies by sleepId)

#### Time-based events (sleepId 1, 2):
```javascript
{
  sleepId: 1,           // Required: ID from SLEEP_REGISTRY
  startTime: "22:30",   // Required: HH:MM format
  endTime: "06:30",     // Required: HH:MM format
  notes: "text"         // Optional: free text
}
```

#### Quality rating (sleepId 3):
```javascript
{
  sleepId: 3,           // Sleep Quality
  value: 4,             // Required: 1-5 (1=poor, 5=great)
  notes: "text"         // Optional
}
```

#### Duration-based (sleepId 4, 5, 6):
```javascript
{
  sleepId: 4,           // Sleep Latency, Awakenings, or REM Sleep
  duration: 15,         // Required: minutes
  notes: "text"         // Optional
}
```

#### Depth metrics (sleepId 7):
```javascript
{
  sleepId: 7,           // Depth Metrics
  awake: 30,            // Optional: minutes awake
  rem: 90,              // Optional: minutes in REM
  light: 180,           // Optional: minutes in light sleep
  deep: 90,             // Optional: minutes in deep sleep
  notes: "text"         // Optional
}
```

### Common Sleep IDs
- **1**: Time In Bed (startTime, endTime)
- **2**: Took a nap (startTime, endTime)
- **3**: Sleep Quality (value 1-5)
- **4**: Sleep Latency (duration in minutes)
- **5**: Number of Awakenings (duration/count)
- **6**: REM Sleep (duration in minutes)
- **7**: Depth Metrics (awake, rem, light, deep durations)

---

## External App JSON Format

### General Structure
```json
{
  "metadata": {
    "appId": "my-app",
    "appName": "My App",
    "version": "1.0",
    "timestamp": "2026-04-15T12:00:00Z",
    "userId": "user-uid-here",
    "documentId": "unique-doc-id"
  },
  "data": {
    "type": "Mind|Fitness|Body|Sleep",
    "items": [...]
  },
  "status": "pending",
  "processedAt": null,
  "errors": []
}
```

### Mind Example
```json
{
  "data": {
    "type": "Mind",
    "items": [{
      "date": "2026-04-15",
      "activityId": 2,
      "duration": 30,
      "notes": "Solved 15 chess puzzles"
    }]
  }
}
```

### Fitness Example
```json
{
  "data": {
    "type": "Fitness",
    "items": [{
      "date": "2026-04-15",
      "activityId": 10,
      "duration": 45,
      "intensity": "moderate",
      "notes": "Morning run, 5K"
    }]
  }
}
```

### Body Example
```json
{
  "data": {
    "type": "Body",
    "items": [{
      "date": "2026-04-15",
      "bodyId": 1,
      "value": 175.5,
      "notes": "Morning weight"
    }]
  }
}
```

### Sleep Example
```json
{
  "data": {
    "type": "Sleep",
    "items": [{
      "date": "2026-04-15",
      "sleepId": 1,
      "startTime": "22:30",
      "endTime": "06:30",
      "notes": "Good night's sleep"
    }]
  }
}
```

---

## Validation Requirements

### Mind Activities
- `activityId` must exist in `MIND_REGISTRY`
- `duration` (if provided) must be positive number
- `date` must be valid YYYY-MM-DD format

### Fitness Activities
- `activityId` must exist in `ACTIVITIES_REGISTRY`
- `duration` (if provided) must be positive number
- `intensity` (if provided) must be: "light", "moderate", or "vigorous"
- `date` must be valid YYYY-MM-DD format

### Body Measurements
- `bodyId` must exist in `BODY_REGISTRY`
- `value` is required and must be a number
- `date` must be valid YYYY-MM-DD format

### Sleep Events
- `sleepId` must exist in `SLEEP_REGISTRY`
- Fields required depend on `sleepId` type (see structure above)
- `date` must be valid YYYY-MM-DD format
- Time fields must be in HH:MM format (24-hour)

---

## Notes
- All dates use YYYY-MM-DD format
- All times use HH:MM format (24-hour)
- Duration is always in minutes
- Custom fields can be added and will be preserved in notes
- Conflict resolution: replace existing data with same ID on same date
