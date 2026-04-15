# External App Import System - Technical Reference

**Audience:** Vimsy maintainers and AI agents working on Vimsy codebase  
**Version:** 1.0  
**Last Updated:** 2026-04-15

---

## System Overview

The external app import system allows third-party apps to upload health/fitness data to Vimsy via Firebase Firestore. Data is validated, processed, and merged into the user's day records.

### Architecture

```
External App → Firestore → Vimsy (Real-time Listener) → Validation → Import → Day Editor
```

### Key Components

1. **Firestore Path:** `users/{userId}/externalAppData/{appId}/documents/{documentId}`
2. **Real-time Listener:** `setupExternalAppDataListener()` - Monitors for pending documents
3. **Validation:** Type-specific validation functions check registry IDs and field formats
4. **Processing:** Type-specific processing functions build correct data structures
5. **Import:** Type-specific import functions merge data into day records
6. **Status Update:** Document status updated to "processed" or "error"

---

## File Structure

### Main Implementation
- **`Vimsy-external-app-import.js`** (~1200 lines)
  - Document validation
  - Item validation (Mind, Fitness, Body, Sleep)
  - Item processing (Mind, Fitness, Body, Sleep)
  - Item import (Mind, Fitness, Body, Sleep)
  - Status monitoring and updates

### Documentation
- **`TestApp/DEVELOPER-GUIDE.md`** - External developer guide
- **`TestApp/external-app-data-structures.md`** - Data structure reference
- **`DOCUMENTS/external-app-import-technical-reference.md`** - This file

### Test App
- **`TestApp/VimsyTestApp.html`** - Working test implementation
- **`TestApp/README.md`** - Test app documentation

### Security
- **`DOCUMENTS/firestore.rules`** - Firestore security rules with collectionGroup support
- **`DOCUMENTS/firestore-indexes-needed.md`** - Required composite indexes

---

## Data Flow

### 1. External App Upload
```javascript
// External app creates document
const doc = {
  metadata: { appId, appName, version, timestamp, userId, documentId },
  data: { type: "Mind", items: [...] },
  status: "pending",
  processedAt: null,
  errors: []
};

// Upload to Firestore
await firestore
  .collection('users').doc(userId)
  .collection('externalAppData').doc(appId)
  .collection('documents').doc(documentId)
  .set(doc);
```

### 2. Vimsy Detection
```javascript
// Real-time listener (setupExternalAppDataListener)
firestore.collectionGroup('documents')
  .where('metadata.userId', '==', userId)
  .where('status', '==', 'pending')
  .onSnapshot(snapshot => {
    snapshot.docs.forEach(doc => {
      processExternalAppDocument(appId, documentId, doc.data());
    });
  });
```

### 3. Validation
```javascript
// Document schema validation
validateExternalAppDocument(doc);

// Item validation (type-specific)
switch (doc.data.type) {
  case 'Mind': validateMindActivityItem(item); break;
  case 'Fitness': validateFitnessActivityItem(item); break;
  case 'Body': validateBodyMeasurementItem(item); break;
  case 'Sleep': validateSleepEventItem(item); break;
}
```

### 4. Processing
```javascript
// Convert to Vimsy format (type-specific)
const activity = processMindActivityItem(item, appName);
// Returns: { activityId, duration, notes }
```

### 5. Import
```javascript
// Merge into day records
const result = await importMindActivities(doc);
// - Gets/creates day record
// - Adds/replaces activity in day.mindActivities
// - Saves to localStorage
// - Marks days dirty for cloud sync
```

### 6. Status Update
```javascript
// Update document status
await docRef.update({
  status: result.success ? 'processed' : 'error',
  processedAt: new Date().toISOString(),
  errors: result.errors
});
```

---

## Supported Data Types

### Mind Activities
- **Day Field:** `day.mindActivities`
- **Registry:** `MIND_REGISTRY`
- **ID Field:** `activityId`
- **Validation:** `validateMindActivityItem()`
- **Processing:** `processMindActivityItem()`
- **Import:** `importMindActivities()`

### Fitness Activities
- **Day Field:** `day.fitnessActivities`
- **Registry:** `ACTIVITIES_REGISTRY`
- **ID Field:** `activityId`
- **Validation:** `validateFitnessActivityItem()`
- **Processing:** `processFitnessActivityItem()`
- **Import:** `importFitnessActivities()`

### Body Measurements
- **Day Field:** `day.bodyMeasurements`
- **Registry:** `BODY_REGISTRY`
- **ID Field:** `bodyId`
- **Validation:** `validateBodyMeasurementItem()`
- **Processing:** `processBodyMeasurementItem()`
- **Import:** `importBodyMeasurements()`

### Sleep Events
- **Day Field:** `day.sleepEvents`
- **Registry:** `SLEEP_REGISTRY`
- **ID Field:** `sleepId`
- **Validation:** `validateSleepEventItem()`
- **Processing:** `processSleepEventItem()`
- **Import:** `importSleepEvents()`

---

## Function Reference

### Validation Functions

**`validateExternalAppDocument(doc)`**
- Validates document schema
- Checks metadata fields
- Checks data.type and data.items
- Returns: `{ valid: boolean, errors: string[] }`

**`validateMindActivityItem(item)`**
- Validates date format (YYYY-MM-DD)
- Validates activityId exists in MIND_REGISTRY
- Validates duration (optional, positive number)
- Validates notes (optional, string)
- Returns: `{ valid: boolean, errors: string[] }`

**`validateFitnessActivityItem(item)`**
- Same as Mind, plus:
- Validates intensity (optional, light|moderate|vigorous)
- Uses ACTIVITIES_REGISTRY

**`validateBodyMeasurementItem(item)`**
- Validates bodyId exists in BODY_REGISTRY
- Validates value (required, number)

**`validateSleepEventItem(item)`**
- Validates sleepId exists in SLEEP_REGISTRY
- Validates required fields based on sleepId type:
  - sleepId 1,2: startTime, endTime (HH:MM format)
  - sleepId 3: value (1-5)
  - sleepId 7: at least one depth metric

### Processing Functions

**`processMindActivityItem(item, appName)`**
- Builds activity object: `{ activityId, duration, notes }`
- Adds app attribution to notes
- Appends custom fields to notes
- Returns: activity object

**`processFitnessActivityItem(item, appName)`**
- Same as Mind, plus adds intensity if present

**`processBodyMeasurementItem(item, appName)`**
- Builds measurement object: `{ bodyId, value, notes }`

**`processSleepEventItem(item, appName)`**
- Builds sleep event object with all relevant fields
- Includes: sleepId, startTime, endTime, value, duration, depth metrics

### Import Functions

**`importMindActivities(doc)`**
- Gets all user days from localStorage
- For each item:
  - Validates item
  - Gets or creates day record
  - Finds existing activity by activityId
  - Replaces or adds activity to `day.mindActivities`
- Saves updated days to localStorage
- Marks days dirty for cloud sync
- Returns: `{ success: boolean, imported: number, errors: string[] }`

**`importFitnessActivities(doc)`**
- Same pattern, uses `day.fitnessActivities`

**`importBodyMeasurements(doc)`**
- Same pattern, uses `day.bodyMeasurements`
- Finds existing by bodyId

**`importSleepEvents(doc)`**
- Same pattern, uses `day.sleepEvents`
- Finds existing by sleepId

### Main Processing Function

**`processExternalAppDocument(appId, documentId, doc)`**
- Validates document schema
- Dispatches to type-specific import function
- Updates document status in Firestore
- Returns: `{ success: boolean, message: string, errors: string[] }`

### Listener Functions

**`setupExternalAppDataListener(userId)`**
- Sets up real-time listener on collectionGroup('documents')
- Filters by userId and status='pending'
- Calls processExternalAppDocument for each pending doc

**`checkAndImportExternalAppData(userId)`**
- One-time check for pending documents
- Called on startup and manual sync
- Uses same collectionGroup query

---

## Conflict Resolution

**Strategy:** Replace existing (not merge)

When importing an item with the same ID on the same date:
- **Mind:** Same `activityId` → Replace
- **Fitness:** Same `activityId` → Replace
- **Body:** Same `bodyId` → Replace
- **Sleep:** Same `sleepId` → Replace

**Rationale:** External apps are authoritative for their data. Latest upload wins.

---

## Error Handling

### Validation Errors
```javascript
// Item fails validation
errors.push(`Item validation failed: ${validation.errors.join(', ')}`);
// Continue processing other items
```

### Import Errors
```javascript
try {
  // Process item
} catch (itemError) {
  errors.push(`Failed to process item: ${itemError.message}`);
  // Continue processing other items
}
```

### Fatal Errors
```javascript
try {
  // Import function
} catch (error) {
  return {
    success: false,
    imported: 0,
    errors: [`Fatal error: ${error.message}`]
  };
}
```

### Status Updates
```javascript
// Success
await docRef.update({
  status: 'processed',
  processedAt: new Date().toISOString()
});

// Error
await docRef.update({
  status: 'error',
  processedAt: new Date().toISOString(),
  errors: result.errors
});
```

---

## Console Logging

All import activity is logged with prefixed tags for filtering:

```
[ExternalAppImport] - General system
[ExternalAppImport:Mind] - Mind imports
[ExternalAppImport:Fitness] - Fitness imports
[ExternalAppImport:Body] - Body imports
[ExternalAppImport:Sleep] - Sleep imports
```

**Example logs:**
```
[ExternalAppImport] Found 1 pending document(s)
[ExternalAppImport] Processing document chess-test-1776270951064 from chess-test-app
[ExternalAppImport:Mind] Processing 1 items from Chess Test App
[ExternalAppImport:Mind] Loaded 365 existing days
[ExternalAppImport:Mind] Imported activity 2 to 2026-04-15 (30 min)
[ExternalAppImport:Mind] Saved 1 activities to local storage
[ExternalAppImport] Import complete: 1 processed, 0 errors
```

---

## Security Rules

### Firestore Rules (firestore.rules)

```javascript
// Collection-specific rules
match /users/{userId}/externalAppData/{appId}/documents/{documentId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow create: if request.auth != null 
    && request.auth.uid == userId
    && request.resource.data.metadata.userId == userId
    && request.resource.data.status == 'pending';
  allow update: if request.auth != null 
    && request.auth.uid == userId
    && (request.resource.data.status == 'processed' 
        || request.resource.data.status == 'error');
}

// CollectionGroup rules
match /{path=**}/documents/{documentId} {
  allow read: if request.auth != null 
    && resource.data.metadata.userId == request.auth.uid;
}
```

### Required Indexes

**Composite Index:**
- Collection: `documents` (collectionGroup)
- Fields: `metadata.userId` (Ascending), `status` (Ascending)

See: `DOCUMENTS/firestore-indexes-needed.md`

---

## Adding New Data Types

To add support for a new data type (e.g., Nutrients):

### 1. Add Validation Function
```javascript
function validateNutrientItem(item) {
  const errors = [];
  // Validate date
  // Validate nutrientId
  // Validate amount
  return { valid: errors.length === 0, errors };
}
```

### 2. Add Processing Function
```javascript
function processNutrientItem(item, appName) {
  const nutrient = {
    nutrientId: item.nutrientId,
    amount: item.amount
  };
  // Build notes
  return nutrient;
}
```

### 3. Add Import Function
```javascript
async function importNutrients(doc) {
  // Get days
  // For each item:
  //   - Validate
  //   - Get/create day
  //   - Add to day.nutrients
  // Save days
  return { success, imported, errors };
}
```

### 4. Update Switch Statement
```javascript
switch (doc.data.type) {
  case 'Mind': return await importMindActivities(doc);
  case 'Fitness': return await importFitnessActivities(doc);
  case 'Body': return await importBodyMeasurements(doc);
  case 'Sleep': return await importSleepEvents(doc);
  case 'Nutrients': return await importNutrients(doc);  // NEW
  default: return { success: false, ... };
}
```

### 5. Update Documentation
- Add to `DEVELOPER-GUIDE.md`
- Add to `external-app-data-structures.md`
- Update test app examples

---

## Testing

### Manual Testing
1. Open `TestApp/VimsyTestApp.html`
2. Sign in with Firebase Auth
3. Click "Generate and Upload Test Data"
4. Check Vimsy console for import logs
5. Verify data in Day Editor

### Automated Testing
- Unit tests for validation functions
- Integration tests for import functions
- End-to-end tests with test documents

### Test Cases
- Valid data import
- Invalid activityId/bodyId/sleepId
- Invalid date format
- Missing required fields
- Duplicate items (conflict resolution)
- Multiple items in one document
- User not authenticated
- Vimsy not running

---

## Performance Considerations

### Real-time Listener
- Uses collectionGroup query (requires composite index)
- Filters by userId and status='pending'
- Only processes pending documents
- Automatically updates when new documents arrive

### Import Performance
- Loads all days once per import
- Uses Map for O(1) day lookup by date
- Batch saves to localStorage
- Single markDaysDirty() call per import

### Cleanup
- External apps should delete processed documents
- Prevents accumulation of old documents
- Reduces query size

---

## Future Enhancements

### Planned Data Types
- **Nutrients:** Direct nutrient additions
- **Lab:** Lab test results
- **Foods:** Custom foods and meal entries

### Potential Features
- Batch import API (multiple documents)
- Conflict resolution options (merge vs replace)
- Import history/audit log
- Rate limiting per app
- App registration/approval system

---

## Troubleshooting

### Document Not Processing
- Check Vimsy is running and user logged in
- Check real-time listener is active
- Check Firestore security rules deployed
- Check composite index created

### Validation Errors
- Check activityId/bodyId/sleepId exists in registry
- Check date format is YYYY-MM-DD
- Check all required fields present
- Check field types match spec

### Data Not Appearing
- Check correct day field used (mindActivities, fitnessActivities, etc.)
- Check Day Editor tab matches data type
- Check localStorage updated
- Check days marked dirty for sync

---

## Related Files

- `Vimsy-external-app-import.js` - Main implementation
- `Vimsy-registries.js` - All registry definitions
- `Vimsy-main.js` - Day record structure
- `Vimsy-firebase.js` - Cloud sync integration
- `TestApp/DEVELOPER-GUIDE.md` - External developer docs
- `TestApp/external-app-data-structures.md` - Data structure reference

---

**For external developer documentation, see `TestApp/DEVELOPER-GUIDE.md`**
