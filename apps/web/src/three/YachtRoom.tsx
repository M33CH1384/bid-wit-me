import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { YACHT } from './yachtLayout';
export function preloadYachtRoom(): void { preloadCubeVenue(YACHT); }
export default function YachtRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={YACHT} quality={quality} handNo={handNo} />;
}
