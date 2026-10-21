/**
 * The /profile route host (Account → REP PROFILE). There is no separate
 * "Rep profile" page anymore (Demetrius 2026-10-20: two profile pages for the
 * same person was "confusing and bad user experience") — this route renders
 * the ONE unified profile (ProfileView) with your own profile as the subject,
 * exactly what tapping your name in the Players menu shows in the Social
 * panel. All profile markup, data and edit flows live in ProfileView.tsx.
 */
import { ProfileView } from './ProfileView';

export default function ProfilePage() {
  return <ProfileView host="page" />;
}
