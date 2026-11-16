# Party Presents

A phone app for the children's party invitations: every party Charlie and Sophie are invited to in one shared calendar, a reminder in good time, and a clear record of who's getting the present, so it isn't a last-minute scramble and you never both buy one.

It's built the same way as [weekly-shop-app](https://github.com/andrewwilson201/weekly-shop-app): a static site (plain HTML, CSS and JavaScript, no build step) on Firebase Hosting at **https://kids-presents.web.app**, with Firebase Auth and Firestore in its own Firebase project (`kids-presents`, database in London), and a few Firebase functions for Claude and the reminders.

## How it works

- **Family**: the first person signs in with Google and makes the family's space. Settings › Share invite link sends a link; whoever opens it and signs in joins. Everything lives under `households/{id}` and only members can read or write it ([`firestore.rules`](firestore.rules)). Changes show on both phones straight away.
- **Children**: Charlie and Sophie to start with (Settings › Children: names, birthdays, add another). Each has a colour, used on their parties everywhere. A party is for one of them or both.
- **Parties**: the home screen lists what's coming up, each with whether a present is sorted. Add one by hand, or from an invite picture.
- **Invite pictures**: on Android, once the app is installed (Chrome › Add to Home screen), open the invite in WhatsApp, tap Share and pick Party Presents. You can also pick the picture from your photos or paste a copied one. The picture is made smaller and saved; the `readInvite` function has Claude read the birthday child's name and age, date, times, venue, address, reply-by date and contact, works out which of the children it's for from the name on the invite, and adds the party marked *Read from an invite picture* so you can check it (**Looks right** or **Change details**). The picture stays with the party.
- **The present**: a party's page shows ideas that fit (budget, age, boy or girl, interests). The friend's age defaults to your child's age if the invite doesn't say. Tap **I'll get this** and the other person sees *Sarah is getting this*; then **Bought it** (where from, how much), **Wrapped** and **Card written**. Claiming is a database transaction, so if you both tap at once only one wins and the other is told who has it (`claimPresent` in [`js/store.js`](js/store.js)). **I'll get it instead** takes over a claim that hasn't been bought yet. **Given to Olivia before** lists earlier presents to the same friend, and those ideas drop down the list.
- **Ideas**: the ideas database starts with 118 researched starter ideas (`data/ideas.json`, made by [`tools/make-ideas.py`](tools/make-ideas.py): typical UK prices, age ranges, interests, search words). Filter by budget, boy or girl, age and interests. **Ask Claude for ideas** (on a party or the Ideas screen) gets 8 suggestions that mix your saved ideas with new ones; new ones are saved, marked *Claude*, so the database grows. Like the good ones, hide the duds, add your own. Each idea has links that search Amazon UK, Argos, Smyths and John Lewis.
- **Cupboard**: presents bought ahead (a sale, a multi-buy). A party's page offers the ones that suit it; using one marks the party's present as bought. An idea's **Bought one for the cupboard** adds it.
- **Reminders**: at 8am every day (`dailyReminders`), phones with notifications on (Settings › Notifications, each phone) get: *Present needed* 10 days before if nothing is bought, *Still need a present* 3 days before, a reply reminder 2 days before the reply-by date if you haven't marked Going or Can't go, and on the day *take the present and card*. The days are in Settings › Reminders. Each one is sent once per party (`reminded` on the party). The rules are `dueReminders` in [`js/gifts.js`](js/gifts.js).
- **Calendar**: a month view with a dot per party in each child's colour. Settings › Phone calendar gives a private calendar feed (`/calendar.ics`, served by the `calendar` function) to add to Google Calendar, so parties show in your phone's own calendar with the present's status in the notes.
- **Who can use it**: the address and repo are public, so anyone with a Google account can sign in, but they can't do anything. The first family can be made freely; that writes `config/access` (`{ households: [id] }`, by the `newHousehold` function), and after that new families can only be made while a `config/open` document exists. Claude, reminders and the calendar feed only serve families on that list. Only the admin key can read or write `config/`.
- **Download your data**: Settings › Data gives everything as one JSON file.

## One-time setup (done 16 Nov 2026)

1. Firebase project `kids-presents` on the Blaze plan, Firestore in `europe-west2` (London), Google sign-in on, web app registered (its config is in [`js/config.js`](js/config.js), with the web push key from Project settings › Cloud Messaging).
2. GitHub secret `FIREBASE_SERVICE_ACCOUNT`: the JSON from Project settings › Service accounts › Generate new private key. It's given the roles it needs in Cloud Shell:
   ```sh
   SA=$(gcloud iam service-accounts list --project kids-presents --filter="email~firebase-adminsdk" --format="value(email)")
   for r in firebasehosting.admin firebaserules.admin cloudfunctions.admin run.admin eventarc.admin cloudscheduler.admin iam.serviceAccountUser secretmanager.admin artifactregistry.admin serviceusage.serviceUsageConsumer datastore.indexAdmin; do
     gcloud projects add-iam-policy-binding kids-presents --member="serviceAccount:$SA" --role="roles/$r" --condition=None --quiet > /dev/null && echo "added $r"
   done
   ```
3. The Claude API key, as a functions secret: `firebase functions:secrets:set ANTHROPIC_API_KEY --project kids-presents`. It's pay-as-you-go from console.anthropic.com; reading an invite or asking for ideas costs a few pence.

After that, everything deploys from GitHub on each push to `main`: `Deploy site` (Hosting), `Deploy database rules` (when `firestore.rules` changes) and `Deploy functions` (when `functions/` or `js/gifts.js` changes). Each can also be run by hand from the Actions tab.

## Run locally and test

```sh
npm install && npm --prefix functions install && node tools/copy-shared.mjs
npm test                                                  # unit tests: reminders, ages, idea matching, invites, calendar feed
firebase emulators:start --only auth,firestore             # Firestore on 8081, Auth on 9099
python3 -m http.server 8000                                # then open http://localhost:8000/?emulator
node test/e2e.mjs                                          # two people, a party, claiming and buying, an invite picture, Claude ideas (pretend), the cupboard
```

With `?emulator` the sign-in page offers a test email sign-in, because Google sign-in needs Google's servers. The `Tests` workflow runs both on every pull request. Screenshots from the end-to-end run land in `test/shots/`.

The app's code: [`js/app.js`](js/app.js) loads the screens in [`js/views/`](js/views) (one file each); [`js/core.js`](js/core.js) is the shell (routing, rendering, tap handlers), [`js/store.js`](js/store.js) the live data, [`js/events.js`](js/events.js) how parties look in lists, and [`js/gifts.js`](js/gifts.js) the rules shared with the functions. Every import carries the same `?v=` number; bump it everywhere (and in `index.html`) when the app changes. `vendor/firebase.js` is the Firebase SDK bundled from [`tools/firebase-entry.js`](tools/firebase-entry.js); the icons are made from `icon.svg` with `node tools/make-icons.cjs icon.svg icons`.
