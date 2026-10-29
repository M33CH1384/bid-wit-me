import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { SPEAKEASY } from './speakeasyLayout';
export function preloadSpeakeasyRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(SPEAKEASY, quality); }
export default function SpeakeasyRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={SPEAKEASY} quality={quality} handNo={handNo} />;
}
