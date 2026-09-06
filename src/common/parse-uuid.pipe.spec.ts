import { BadRequestException } from '@nestjs/common';
import { ParseUuidPipe } from './parse-uuid.pipe';

describe('ParseUuidPipe', () => {
  const pipe = new ParseUuidPipe();

  it('passes valid UUIDs through unchanged', () => {
    expect(pipe.transform('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
  });

  it('rejects malformed ids with a 400', () => {
    for (const bad of ['abc', '123', 'not-a-uuid', '', '3f2504e0-4f89-11d3-9a0c-0305e82c330']) {
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
    }
  });
});
