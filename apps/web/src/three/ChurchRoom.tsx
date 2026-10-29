import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { CHURCH } from './churchLayout';
export function preloadChurchRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(CHURCH, quality); }
export default function ChurchRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={CHURCH} quality={quality} handNo={handNo} />;
}
