// C++-реализация JSON-парсера: тот же байтовый разбор и те же коды ошибок.

struct JsonParser {
  static constexpr int CAP = 65536;
  static constexpr int ROOT_CAP = 4096;
  static constexpr int MAX_DEPTH = 64;

  unsigned char input[CAP];
  unsigned char rootbuf[ROOT_CAP];
  const unsigned char* src = input;

  int pos = 0;
  int len = 0;
  int errCode = 0;
  int errPos = 0;
  int rootType = 0;
  int rootLen = 0;
  double rootNumber = 0.0;
  int nodes = 0;
  int depthMax = 0;
  int numbers = 0;
  int strings = 0;
  int stringBytes = 0;

  inline int fail(int code, int at) {
    errCode = code;
    errPos = at;
    return 0;
  }

  inline void skipWs() {
    while (pos < len) {
      unsigned char c = src[pos];
      if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
      ++pos;
    }
  }

  static double pow10i(int e) {
    double r = 1.0;
    while (e > 0) {
      r *= 10.0;
      --e;
    }
    return r;
  }

  inline int storeByte(bool store, int outlen, unsigned char b) {
    if (store) {
      if (outlen >= ROOT_CAP) return 0;
      rootbuf[outlen] = b;
    }
    return 1;
  }

  inline int emitCp(bool store, int& outlen, int cp) {
    if (cp < 0x80) {
      if (!storeByte(store, outlen, static_cast<unsigned char>(cp))) return 0;
      outlen += 1;
    } else if (cp < 0x800) {
      if (!storeByte(store, outlen, static_cast<unsigned char>(0xC0 | (cp >> 6)))) return 0;
      if (!storeByte(store, outlen + 1, static_cast<unsigned char>(0x80 | (cp & 0x3F)))) return 0;
      outlen += 2;
    } else if (cp < 0x10000) {
      if (!storeByte(store, outlen, static_cast<unsigned char>(0xE0 | (cp >> 12)))) return 0;
      if (!storeByte(store, outlen + 1, static_cast<unsigned char>(0x80 | ((cp >> 6) & 0x3F)))) return 0;
      if (!storeByte(store, outlen + 2, static_cast<unsigned char>(0x80 | (cp & 0x3F)))) return 0;
      outlen += 3;
    } else {
      if (!storeByte(store, outlen, static_cast<unsigned char>(0xF0 | (cp >> 18)))) return 0;
      if (!storeByte(store, outlen + 1, static_cast<unsigned char>(0x80 | ((cp >> 12) & 0x3F)))) return 0;
      if (!storeByte(store, outlen + 2, static_cast<unsigned char>(0x80 | ((cp >> 6) & 0x3F)))) return 0;
      if (!storeByte(store, outlen + 3, static_cast<unsigned char>(0x80 | (cp & 0x3F)))) return 0;
      outlen += 4;
    }
    return 1;
  }

  int hex4(int at, int& out) {
    int v = 0;
    for (int i = 0; i < 4; ++i) {
      if (pos >= len) return fail(6, at);
      unsigned char c = src[pos++];
      int d;
      if (c >= '0' && c <= '9') d = c - '0';
      else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
      else return fail(6, at);
      v = (v << 4) | d;
    }
    out = v;
    return 1;
  }

  int parseString(bool isKey, int depth) {
    int start = pos;
    ++pos;
    int outlen = 0;
    bool store = !isKey && depth == 1;

    for (;;) {
      if (pos >= len) return fail(2, len);
      unsigned char c = src[pos];
      if (c == '"') {
        ++pos;
        if (store) rootLen = outlen;
        ++strings;
        stringBytes += outlen;
        return 1;
      }
      if (c < 0x20) return fail(6, pos);
      if (c == '\\') {
        int esc = pos;
        ++pos;
        if (pos >= len) return fail(2, len);
        unsigned char e = src[pos++];
        int cp;
        if (e == '"' || e == '\\' || e == '/') cp = e;
        else if (e == 'b') cp = 8;
        else if (e == 'f') cp = 12;
        else if (e == 'n') cp = 10;
        else if (e == 'r') cp = 13;
        else if (e == 't') cp = 9;
        else if (e == 'u') {
          int hi;
          if (!hex4(esc, hi)) return 0;
          if (hi >= 0xD800 && hi <= 0xDBFF) {
            if (pos + 1 >= len || src[pos] != '\\' || src[pos + 1] != 'u') return fail(6, esc);
            pos += 2;
            int lo;
            if (!hex4(esc, lo)) return 0;
            if (lo < 0xDC00 || lo > 0xDFFF) return fail(6, esc);
            cp = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
          } else if (hi >= 0xDC00 && hi <= 0xDFFF) {
            return fail(6, esc);
          } else {
            cp = hi;
          }
        } else {
          return fail(6, esc);
        }
        if (!emitCp(store, outlen, cp)) return fail(8, start);
      } else {
        if (!storeByte(store, outlen, c)) return fail(8, start);
        ++outlen;
        ++pos;
      }
    }
  }

  int parseNumber(int depth, int start) {
    bool neg = false;
    if (src[pos] == '-') {
      neg = true;
      ++pos;
      if (pos >= len) return fail(2, len);
    }
    if (pos >= len) return fail(2, len);

    double value = 0.0;
    unsigned char c = src[pos];
    if (c == '0') {
      ++pos;
      if (pos < len && src[pos] >= '0' && src[pos] <= '9') return fail(5, pos);
    } else if (c >= '1' && c <= '9') {
      while (pos < len && src[pos] >= '0' && src[pos] <= '9') {
        value = value * 10.0 + static_cast<double>(src[pos] - '0');
        ++pos;
      }
    } else {
      return fail(5, pos);
    }

    if (pos < len && src[pos] == '.') {
      ++pos;
      if (pos >= len || src[pos] < '0' || src[pos] > '9') return fail(5, pos > len ? len : pos);
      double scale = 0.1;
      while (pos < len && src[pos] >= '0' && src[pos] <= '9') {
        value += static_cast<double>(src[pos] - '0') * scale;
        scale *= 0.1;
        ++pos;
      }
    }

    if (pos < len && (src[pos] == 'e' || src[pos] == 'E')) {
      ++pos;
      bool eneg = false;
      if (pos < len && (src[pos] == '+' || src[pos] == '-')) {
        eneg = src[pos] == '-';
        ++pos;
      }
      if (pos >= len || src[pos] < '0' || src[pos] > '9') return fail(5, pos > len ? len : pos);
      int exp = 0;
      while (pos < len && src[pos] >= '0' && src[pos] <= '9') {
        if (exp < 10000) exp = exp * 10 + (src[pos] - '0');
        ++pos;
      }
      double p = pow10i(exp);
      if (eneg) value /= p;
      else value *= p;
    }

    if (neg) value = -value;
    ++numbers;
    if (depth == 1) {
      rootType = 3;
      rootNumber = value;
    }
    (void)start;
    return 1;
  }

  int parseArray(int depth) {
    ++pos;
    skipWs();
    if (pos < len && src[pos] == ']') {
      ++pos;
      if (depth == 1) rootLen = 0;
      return 1;
    }
    int count = 0;
    for (;;) {
      ++count;
      if (!parseValue(depth + 1)) return 0;
      skipWs();
      if (pos >= len) return fail(2, len);
      if (src[pos] == ',') {
        ++pos;
        skipWs();
        if (pos >= len) return fail(2, len);
        if (src[pos] == ']') return fail(1, pos);
        continue;
      }
      if (src[pos] == ']') {
        ++pos;
        break;
      }
      return fail(1, pos);
    }
    if (depth == 1) rootLen = count;
    return 1;
  }

  int parseObject(int depth) {
    ++pos;
    skipWs();
    if (pos < len && src[pos] == '}') {
      ++pos;
      if (depth == 1) rootLen = 0;
      return 1;
    }
    int count = 0;
    for (;;) {
      skipWs();
      if (pos >= len) return fail(2, len);
      if (src[pos] != '"') return fail(1, pos);
      if (!parseString(true, depth)) return 0;
      skipWs();
      if (pos >= len) return fail(2, len);
      if (src[pos] != ':') return fail(1, pos);
      ++pos;
      ++count;
      if (!parseValue(depth + 1)) return 0;
      skipWs();
      if (pos >= len) return fail(2, len);
      if (src[pos] == ',') {
        ++pos;
        skipWs();
        if (pos >= len) return fail(2, len);
        if (src[pos] == '}') return fail(1, pos);
        continue;
      }
      if (src[pos] == '}') {
        ++pos;
        break;
      }
      return fail(1, pos);
    }
    if (depth == 1) rootLen = count;
    return 1;
  }

  int parseValue(int depth) {
    if (depth > MAX_DEPTH) return fail(4, pos);
    if (depth > depthMax) depthMax = depth;
    skipWs();
    if (pos >= len) return fail(2, len);

    unsigned char c = src[pos];
    int start = pos;
    ++nodes;

    if (c == '{') {
      if (depth == 1) rootType = 6;
      return parseObject(depth);
    }
    if (c == '[') {
      if (depth == 1) rootType = 5;
      return parseArray(depth);
    }
    if (c == '"') {
      if (depth == 1) rootType = 4;
      return parseString(false, depth);
    }
    if (c == 't') {
      if (pos + 4 <= len && src[pos + 1] == 'r' && src[pos + 2] == 'u' && src[pos + 3] == 'e') {
        pos += 4;
        if (depth == 1) rootType = 2;
        return 1;
      }
      return fail(1, start);
    }
    if (c == 'f') {
      if (pos + 5 <= len && src[pos + 1] == 'a' && src[pos + 2] == 'l' && src[pos + 3] == 's' && src[pos + 4] == 'e') {
        pos += 5;
        if (depth == 1) rootType = 1;
        return 1;
      }
      return fail(1, start);
    }
    if (c == 'n') {
      if (pos + 4 <= len && src[pos + 1] == 'u' && src[pos + 2] == 'l' && src[pos + 3] == 'l') {
        pos += 4;
        if (depth == 1) rootType = 0;
        return 1;
      }
      return fail(1, start);
    }
    if (c == '-' || (c >= '0' && c <= '9')) {
      return parseNumber(depth, start);
    }
    return fail(1, pos);
  }

  int parse(int n) {
    errCode = 0;
    errPos = 0;
    rootType = 0;
    rootLen = 0;
    rootNumber = 0.0;
    nodes = 0;
    depthMax = 0;
    numbers = 0;
    strings = 0;
    stringBytes = 0;

    if (n < 0 || n > CAP) {
      errCode = 8;
      errPos = 0;
      return 8;
    }

    pos = 0;
    len = n;
    src = input;

    if (!parseValue(1)) return errCode;
    skipWs();
    if (pos != len) {
      fail(3, pos);
      return errCode;
    }
    return 0;
  }
};

static JsonParser parser;

extern "C" {

int json_input_ptr() { return static_cast<int>(reinterpret_cast<unsigned long>(parser.input)); }
int json_parse(int n) { return parser.parse(n); }
int json_error_pos() { return parser.errPos; }
int json_error_code() { return parser.errCode; }
int json_root_type() { return parser.rootType; }
double json_root_number() { return parser.rootNumber; }
int json_root_len() { return parser.rootLen; }
int json_root_ptr() { return static_cast<int>(reinterpret_cast<unsigned long>(parser.rootbuf)); }
int json_nodes() { return parser.nodes; }
int json_depth() { return parser.depthMax; }
int json_numbers() { return parser.numbers; }
int json_strings() { return parser.strings; }
int json_string_bytes() { return parser.stringBytes; }

}
