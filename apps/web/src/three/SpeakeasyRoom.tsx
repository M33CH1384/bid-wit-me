import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { SPEAKEASY } from './speakeasyLayout';
export function preloadSpeakeasyRoom(): void { preloadCubeVenue(SPEAKEASY); }
export default function SpeakeasyRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={SPEAKEASY} quality={quality} handNo={handNo} />;
}
