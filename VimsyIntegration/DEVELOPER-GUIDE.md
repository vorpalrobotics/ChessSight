# Vimsy External App Integration - Developer Guide

**Audience:** External app developers integrating with Vimsy  
**Version:** 1.0  
**Last Updated:** 2026-04-15

---

## Quick Start (5 Minutes)

### What You Need
- Your app uses the **same Firebase project** as Vimsy
- User authenticates with Firebase Auth
- You know your data type: Mind, Fitness, Body, or Sleep

### Minimal Integration

```javascript
// 1. Initialize Firebase (same config as Vimsy)
firebase.initializeApp(firebaseConfig);

// 2. Create import document
const importDoc = {
  metadata: {
    appId: "my-app-id",
    appName: "My App Name",
    version: "1.0",
    timestamp: new Date().toISOString(),
    userId: firebase.auth().currentUser.uid,
    documentId: `import-${Date.now()}`
  },
  data: {
    type: "Mind",  // or Fitness, Body, Sleep
    items: [{
      date: "2026-04-15",
      activityId: 2,  // See registries below
      duration: 30,
      notes: "My activity"
    }]
  },
  status: "pending",
  processedAt: null,
  errors: []
};

// 3. Upload to Firestore
await firebase.firestore()
  .collection('users').doc(firebase.auth().currentUser.uid)
  .collection('externalAppData').doc(importDoc.metadata.appId)
  .collection('documents').doc(importDoc.metadata.documentId)
  .set(importDoc);

// 4. Monitor status
const docRef = firebase.firestore()
  .collection('users').doc(firebase.auth().currentUser.uid)
  .collection('externalAppData').doc(importDoc.metadata.appId)
  .collection('documents').doc(importDoc.metadata.documentId);

docRef.onSnapshot(snapshot => {
  const doc = snapshot.data();
  if (doc.status === 'processed') {
    console.log('✓ Success!');
  } else if (doc.status === 'error') {
    console.error('✗ Failed:', doc.errors);
  }
});
```

---

## Data Types & Structures

### Mind Activities

**Use Case:** Chess apps, meditation, reading trackers

```javascript
{
  date: "2026-04-15",        // Required: YYYY-MM-DD
  activityId: 2,              // Required: See MIND_REGISTRY
  duration: 30,               // Optional: minutes
  notes: "Solved 15 puzzles", // Optional
  customFields: {             // Optional: app-specific data
    puzzlesSolved: 15,
    accuracy: 87
  }
}
```

**Common Activity IDs:**
- 2: Chess, puzzles
- 3: Chess, competitive
- 8: Solving puzzles, jigsaw
- 9: Solving puzzles, crossword
- 10: Solving puzzles, sudoku
- 14: Reading, fiction
- 15: Reading, non-fiction
- 17: Meditation

**Full list:** See `Vimsy-registries.js` → `MIND_REGISTRY`

---

### Fitness Activities

**Use Case:** Running apps, fitness trackers, workout apps

```javascript
{
  date: "2026-04-15",
  activityId: 10,             // Required: See ACTIVITIES_REGISTRY
  duration: 45,               // Optional: minutes
  intensity: "moderate",      // Optional: light|moderate|vigorous
  notes: "Morning run",
  customFields: {
    distance: 5.0,
    avgHeartRate: 145
  }
}
```

**Common Activity IDs:**
- 1: Walking, slowly (<2 mph)
- 2: Walking, 2.5 mph
- 3: Walking, 3.0 mph
- 10: Running, 5 mph (12 min/mile)
- 11: Running, 6 mph (10 min/mile)
- 20: Cycling, leisure (<10 mph)
- 21: Cycling, 10-12 mph
- 30: Weight lifting, light/moderate
- 50: Swimming, leisurely

**Full list:** See `Vimsy-registries.js` → `ACTIVITIES_REGISTRY`

---

### Body Measurements

**Use Case:** Smart scales, body composition analyzers

```javascript
{
  date: "2026-04-15",
  bodyId: 1,                  // Required: See BODY_REGISTRY
  value: 175.5,               // Required: measurement value
  notes: "Morning weight",
  customFields: {
    deviceId: "scale-123"
  }
}
```

**Common Body IDs:**
- 1: Weight (lbs or kg)
- 2: Body Fat %
- 3: Muscle Mass %
- 5: Waist Circumference
- 11: Body Water %
- 13: Visceral Fat Rating
- 15: Basal Metabolic Rate

**Full list:** See `Vimsy-registries.js` → `BODY_REGISTRY`

---

### Sleep Events

**Use Case:** Sleep trackers, smart beds, wearables

**Time-based (sleepId 1, 2):**
```javascript
{
  date: "2026-04-15",
  sleepId: 1,                 // Time In Bed
  startTime: "22:30",         // Required: HH:MM
  endTime: "06:30",           // Required: HH:MM
  notes: "Good sleep"
}
```

**Quality rating (sleepId 3):**
```javascript
{
  date: "2026-04-15",
  sleepId: 3,                 // Sleep Quality
  value: 4,                   // Required: 1-5
  notes: "Felt refreshed"
}
```

**Depth metrics (sleepId 7):**
```javascript
{
  date: "2026-04-15",
  sleepId: 7,
  awake: 30,                  // Optional: minutes
  rem: 90,
  light: 180,
  deep: 90,
  notes: "Tracked by device"
}
```

**Common Sleep IDs:**
- 1: Time In Bed (startTime, endTime)
- 2: Took a nap (startTime, endTime)
- 3: Sleep Quality (value 1-5)
- 4: Sleep Latency (duration)
- 7: Depth Metrics (awake, rem, light, deep)

**Full list:** See `Vimsy-registries.js` → `SLEEP_REGISTRY`

---

## Complete Integration Example

### Chess Puzzles App

```javascript
class ChessPuzzlesVimsyIntegration {
  constructor() {
    this.appId = 'chess-puzzles-pro';
    this.appName = 'Chess Puzzles Pro';
  }
  
  async uploadSession(session) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not authenticated');
    
    const documentId = `${this.appId}-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    
    const importDoc = {
      metadata: {
        appId: this.appId,
        appName: this.appName,
        version: "1.0",
        timestamp: new Date().toISOString(),
        userId: user.uid,
        documentId: documentId
      },
      data: {
        type: "Mind",
        items: [{
          date: today,
          activityId: 2,  // Chess puzzles
          duration: session.timeSpent,
          notes: `Solved ${session.puzzlesSolved} puzzles`,
          customFields: {
            puzzlesSolved: session.puzzlesSolved,
            accuracy: session.accuracy,
            difficulty: session.difficulty
          }
        }]
      },
      status: "pending",
      processedAt: null,
      errors: []
    };
    
    // Upload
    await firebase.firestore()
      .collection('users').doc(user.uid)
      .collection('externalAppData').doc(this.appId)
      .collection('documents').doc(documentId)
      .set(importDoc);
    
    // Monitor
    const docRef = firebase.firestore()
      .collection('users').doc(user.uid)
      .collection('externalAppData').doc(this.appId)
      .collection('documents').doc(documentId);
    
    return docRef.onSnapshot(snapshot => {
      const doc = snapshot.data();
      if (doc.status === 'processed') {
        this.showSuccess('Session synced to Vimsy!');
        docRef.delete();  // Cleanup
      } else if (doc.status === 'error') {
        this.showError('Sync failed: ' + doc.errors.join(', '));
      }
    });
  }
  
  showSuccess(msg) { alert('✓ ' + msg); }
  showError(msg) { alert('✗ ' + msg); }
}

// Usage
const integration = new ChessPuzzlesVimsyIntegration();
await integration.uploadSession({
  puzzlesSolved: 15,
  timeSpent: 30,
  accuracy: 87,
  difficulty: "intermediate"
});
```

---

## Testing

### Test Checklist
1. **Upload test document** to Firestore
2. **Check Firestore Console** - Document exists at correct path
3. **Check Vimsy console** - Filter for `[ExternalAppImport]`
4. **Check Day Editor** - Data appears in correct tab
5. **Check status** - Document status = "processed"

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "Missing permissions" | Auth error | User must sign in |
| "Invalid activityId" | Wrong ID | Check registry |
| Status stays "pending" | Vimsy not running | Open Vimsy, sign in |
| Data not visible | Wrong field | Verify data type |

---

## Document Schema

### Firestore Path
```
users/{userId}/externalAppData/{appId}/documents/{documentId}
```

### Required Fields

**metadata:**
- `appId` (string) - Your app's unique ID
- `appName` (string) - Display name
- `version` (string) - Schema version ("1.0")
- `timestamp` (string) - ISO 8601 timestamp
- `userId` (string) - Must match authenticated user
- `documentId` (string) - Unique document ID

**data:**
- `type` (string) - "Mind", "Fitness", "Body", or "Sleep"
- `items` (array) - Array of data items

**status:**
- `status` (string) - "pending", "processed", or "error"
- `processedAt` (string/null) - ISO 8601 timestamp when processed
- `errors` (array) - Error messages if status = "error"

---

## Security & Privacy

### User Control
- User must explicitly connect Vimsy account
- User can disable/enable sync
- User can disconnect anytime
- Data only uploaded if authenticated

### Best Practices
1. **Validate before upload** - Check required fields
2. **Monitor status** - Always listen for results
3. **Clean up** - Delete processed documents
4. **Handle errors** - Show user-friendly messages
5. **Batch when possible** - Multiple items in one document
6. **Add custom fields** - Include app-specific metadata

---

## Examples by App Type

### Meditation App (Mind)
```javascript
{
  date: "2026-04-15",
  activityId: 17,  // Meditation
  duration: 20,
  notes: "Morning meditation",
  customFields: {
    sessionType: "guided",
    instructor: "Calm App"
  }
}
```

### Running App (Fitness)
```javascript
{
  date: "2026-04-15",
  activityId: 10,  // Running, 5 mph
  duration: 45,
  intensity: "moderate",
  notes: "Morning run",
  customFields: {
    distance: 5.2,
    avgPace: "8:40",
    avgHeartRate: 145,
    calories: 420
  }
}
```

### Smart Scale (Body)
```javascript
[
  {
    date: "2026-04-15",
    bodyId: 1,  // Weight
    value: 175.5,
    notes: "Morning weight"
  },
  {
    date: "2026-04-15",
    bodyId: 2,  // Body Fat %
    value: 18.5,
    notes: "Body composition"
  }
]
```

### Sleep Tracker (Sleep)
```javascript
[
  {
    date: "2026-04-15",
    sleepId: 1,  // Time In Bed
    startTime: "22:30",
    endTime: "06:30"
  },
  {
    date: "2026-04-15",
    sleepId: 3,  // Quality
    value: 4
  },
  {
    date: "2026-04-15",
    sleepId: 7,  // Depth
    awake: 25,
    rem: 95,
    light: 185,
    deep: 85
  }
]
```

---

## Reference Files

- **`VimsyTestApp.html`** - Working test app with complete code
- **`Vimsy-registries.js`** - All valid activity/body/sleep IDs
- **`external-app-data-structures.md`** - Detailed technical reference

---

## Support

Questions? Review:
1. `VimsyTestApp.html` - Working example
2. `external-app-data-structures.md` - Technical details
3. Vimsy console logs - Filter for `[ExternalAppImport]`

---

**Ready to integrate? Copy the code examples above and customize for your app!**
