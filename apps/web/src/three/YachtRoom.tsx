import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { YACHT } from './yachtLayout';
export function preloadYachtRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(YACHT, quality); }
export default function YachtRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={YACHT} quality={quality} handNo={handNo} />;
}
