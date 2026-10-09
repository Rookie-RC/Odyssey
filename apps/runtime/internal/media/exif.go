package media

import (
	"bufio"
	"encoding/binary"
	"io"
)

// EXIF orientation values (TIFF tag 0x0112). Browsers apply this tag when
// they display an original JPEG (CSS image-orientation: from-image is the
// default), so thumbnails must apply it too or phone photos would come out
// sideways next to their upright originals.
//
//	1 normal            5 transpose (mirror across the main diagonal)
//	2 mirror horizontal 6 rotate 90° clockwise
//	3 rotate 180°       7 transverse (mirror across the anti-diagonal)
//	4 mirror vertical   8 rotate 90° counter-clockwise
const orientationTag = 0x0112

// maxHeaderScan bounds how much of a JPEG is scanned for the Exif segment.
// APP1 must precede the image data and is at most 64 KiB, so a well-formed
// file has it within the first few hundred KiB.
const maxHeaderScan = 1 << 20

// jpegOrientation returns the EXIF orientation (1–8) of the JPEG read from r,
// or 1 when there is none or the header is malformed. It walks the marker
// segments up to the first scan (SOS), looking for an APP1 "Exif" segment.
func jpegOrientation(r io.Reader) int {
	br := bufio.NewReader(io.LimitReader(r, maxHeaderScan))
	var soi [2]byte
	if _, err := io.ReadFull(br, soi[:]); err != nil || soi[0] != 0xFF || soi[1] != 0xD8 {
		return 1
	}
	for {
		b, err := br.ReadByte()
		if err != nil || b != 0xFF {
			return 1 // not at a marker: malformed, give up
		}
		marker, err := br.ReadByte()
		for err == nil && marker == 0xFF { // fill bytes
			marker, err = br.ReadByte()
		}
		if err != nil {
			return 1
		}
		switch {
		case marker == 0x01 || (marker >= 0xD0 && marker <= 0xD8):
			continue // TEM / RSTn / SOI: no length field
		case marker == 0xDA || marker == 0xD9:
			return 1 // start of scan / end of image: no Exif before the pixels
		}
		var lenBuf [2]byte
		if _, err := io.ReadFull(br, lenBuf[:]); err != nil {
			return 1
		}
		n := int(binary.BigEndian.Uint16(lenBuf[:])) - 2
		if n < 0 {
			return 1
		}
		if marker != 0xE1 { // not APP1
			if _, err := br.Discard(n); err != nil {
				return 1
			}
			continue
		}
		seg := make([]byte, n)
		if _, err := io.ReadFull(br, seg); err != nil {
			return 1
		}
		// APP1 is also used for XMP; only an Exif payload answers the
		// question, otherwise keep scanning.
		if o, ok := exifOrientation(seg); ok {
			return o
		}
	}
}

// exifOrientation extracts tag 0x0112 from IFD0 of an APP1 payload
// ("Exif\0\0" + TIFF structure). ok is false when seg is not an Exif payload
// or carries no orientation tag.
func exifOrientation(seg []byte) (orientation int, ok bool) {
	const hdr = "Exif\x00\x00"
	if len(seg) < len(hdr) || string(seg[:len(hdr)]) != hdr {
		return 0, false
	}
	tiff := seg[len(hdr):]
	if len(tiff) < 8 {
		return 0, false
	}
	var bo binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0, false
	}
	if bo.Uint16(tiff[2:4]) != 42 {
		return 0, false
	}
	ifd := int(bo.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 0, false
	}
	count := int(bo.Uint16(tiff[ifd:]))
	for i := 0; i < count; i++ {
		e := ifd + 2 + 12*i // entry: tag(2) type(2) count(4) value(4)
		if e+12 > len(tiff) {
			return 0, false
		}
		if bo.Uint16(tiff[e:]) != orientationTag {
			continue
		}
		var v int
		switch bo.Uint16(tiff[e+2:]) {
		case 3: // SHORT — stored left-justified in the 4-byte value field
			v = int(bo.Uint16(tiff[e+8:]))
		case 4: // LONG — non-standard, but seen in the wild
			v = int(bo.Uint32(tiff[e+8:]))
		default:
			return 1, true
		}
		if v < 1 || v > 8 {
			return 1, true
		}
		return v, true
	}
	return 0, false
}

// orientedSourcePixel maps a pixel (dx, dy) of the upright (displayed) image
// back to the stored image of size w×h, for EXIF orientation o. For o ≥ 5 the
// displayed image is h×w (rotated by 90°).
func orientedSourcePixel(o, dx, dy, w, h int) (sx, sy int) {
	switch o {
	case 2:
		return w - 1 - dx, dy
	case 3:
		return w - 1 - dx, h - 1 - dy
	case 4:
		return dx, h - 1 - dy
	case 5:
		return dy, dx
	case 6:
		return dy, h - 1 - dx
	case 7:
		return w - 1 - dy, h - 1 - dx
	case 8:
		return w - 1 - dy, dx
	default:
		return dx, dy
	}
}
