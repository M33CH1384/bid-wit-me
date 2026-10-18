import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { CHURCH } from './churchLayout';
export function preloadChurchRoom(): void { preloadCubeVenue(CHURCH); }
export default function ChurchRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={CHURCH} quality={quality} handNo={handNo} />;
}
