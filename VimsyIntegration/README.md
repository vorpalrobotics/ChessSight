# Vimsy External App Integration Test

## Quick Start

1. Open `VimsyTestApp.html` in a web browser
2. Click "Login to Firebase"
3. Sign in with your Google account (same one you use in Vimsy)
4. Enter duration (default: 10 minutes)
5. Click "Upload Chess Puzzle Activity"
6. Watch the activity log for status updates
7. Open Vimsy and check today's date for the Chess Puzzle activity

## What This Tests

This app demonstrates the complete integration flow:

1. **Firebase Authentication** - User logs in with Google
2. **Document Creation** - Constructs the standardized JSON format
3. **Firestore Upload** - Writes to `externalAppData` staging area
4. **Status Monitoring** - Watches for Vimsy to process the import
5. **Error Handling** - Shows failures and allows retry

## How It Works

### Document Path
```
users/{userId}/externalAppData/chess-test-app/documents/{documentId}
```

**Important:** Firestore requires an even number of path segments (collection/doc/collection/doc/...). The `documents` subcollection ensures this requirement is met.

### Document Structure
```json
{
  "metadata": {
    "appId": "chess-test-app",
    "appName": "Chess Test App",
    "version": "1.0",
    "timestamp": "2026-04-10T12:00:00Z",
    "userId": "user-uid-here",
    "documentId": "chess-test-1712751600000"
  },
  "data": {
    "type": "Mind",
    "items": [{
      "date": "2026-04-10",
      "activityId": 2,
      "duration": 10,
      "notes": "Test import from Chess Test App",
      "customFields": {
        "testData": true,
        "timestamp": "2026-04-10T12:00:00Z"
      }
    }]
  },
  "status": "pending",
  "processedAt": null,
  "errors": []
}
```

## Integration Guide for Other Apps

### Step 1: Copy Firebase Config
Use the same `firebaseConfig` object from this test app.

### Step 2: Authenticate User
```javascript
const provider = new firebase.auth.GoogleAuthProvider();
firebase.auth().signInWithPopup(provider);
```

### Step 3: Create Document
Change these fields for your app:
- `metadata.appId` - Your app's unique ID (e.g., "my-chess-app")
- `metadata.appName` - Your app's display name (e.g., "My Chess App")
- `data.items[].activityId` - Activity ID from Vimsy's registry
- `data.items[].duration` - Duration in minutes
- `data.items[].notes` - Custom notes

### Step 4: Upload to Firestore
```javascript
const path = `users/${userId}/externalAppData/${appId}/documents/${documentId}`;
await firebase.firestore().doc(path).set(document);
```

### Step 5: Monitor Status (Optional)
```javascript
firebase.firestore().doc(path).onSnapshot((snapshot) => {
  const doc = snapshot.data();
  if (doc.status === 'processed') {
    // Success!
  } else if (doc.status === 'error') {
    // Failed - check doc.errors
  }
});
```

## Activity IDs

Common Mind activity IDs in Vimsy:
- **2** - Chess Puzzles
- **3** - Chess Competitive
- **8** - Jigsaw Puzzles
- **9** - Crossword Puzzles
- **10** - Sudoku Puzzles

See Vimsy's `ACTIVITIES_REGISTRY` in `Vimsy-registries.js` for the complete list.

## Data Types

Supported data types:
- `"Mind"` - Mental activities (chess, meditation, reading)
- `"Fitness"` - Physical activities (running, cycling, etc.)
- `"Sleep"` - Sleep tracking
- `"Body"` - Body measurements (weight, body fat %, etc.)
- `"Nutrients"` - Direct nutrient additions
- `"Lab"` - Lab test results

## Troubleshooting

### "Permission denied" error
- Ensure Firestore security rules are deployed
- Check that you're logged in with the correct account

### "Document not processed"
- Check Vimsy console for `[ExternalAppImport]` messages
- Verify activityId is valid for the data type
- Check document status in Firestore console

### "Upload failed"
- Check browser console for detailed error
- Verify Firebase config is correct
- Ensure internet connection is stable

## Console Logging

All operations are logged to the browser console with prefixes:
- `[Firebase]` - Firebase initialization
- `[Auth]` - Authentication events
- `[Document]` - Document creation
- `[Upload]` - Upload operations
- `[Monitor]` - Status monitoring
- `[Delete]` - Deletion operations
- `[Log]` - Activity log entries

Open browser DevTools (F12) to see detailed logs.

## Testing Checklist

- [ ] Login works
- [ ] Upload creates document in Firestore
- [ ] Document status changes to "processed"
- [ ] Activity appears in Vimsy for today's date
- [ ] Retry works after failure
- [ ] Delete removes test documents
- [ ] Console shows detailed logs

## Notes

- Documents are created with `status: "pending"`
- Vimsy processes them and updates status to "processed" or "error"
- The test app monitors status changes in real-time
- Delete button removes all test documents (useful for cleanup)
