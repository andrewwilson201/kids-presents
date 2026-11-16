// Phone notifications through Firebase Cloud Messaging, to every phone in the
// household that turned them on (households/{hid}/devices). Sent as data
// messages; sw.js shows them. Returns how many phones it reached. Never throws.
import { getMessaging } from 'firebase-admin/messaging';

const SITE = process.env.SITE_URL || 'https://kids-presents.web.app/';

export async function notify(h, { title, body, link = '', tag = '', to = null }) {
  try {
    const devices = (await h.ref.collection('devices').get()).docs.filter(d => !to || d.data().uid === to);
    if (!devices.length) return 0;
    if (process.env.FIRESTORE_EMULATOR_HOST) return devices.length; // tests: nothing is really sent
    const res = await getMessaging().sendEach(devices.map(d => ({
      token: d.data().token,
      data: { title, body, link: SITE + link, tag },
      webpush: { headers: { Urgency: 'high', TTL: String(6 * 3600) } },
    })));
    // Phones that uninstalled or turned it off: forget them.
    await Promise.all(res.responses.map((r, i) => !r.success && /registration-token-not-registered|invalid-argument|invalid-registration/.test(r.error?.code || '') ? devices[i].ref.delete() : null));
    return res.successCount;
  } catch (e) {
    console.log(`Notification not sent: ${e.message}`);
    return 0;
  }
}
