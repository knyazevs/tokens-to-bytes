// C-эталон JSON-парсера. Тот же алгоритм и те же коды ошибок, что и в
// остальных пяти сборках: байтовый разбор, счётчики структуры и корневое значение.

#define CAP 65536
#define ROOT_CAP 4096
#define MAX_DEPTH 64

static unsigned char input[CAP];
static unsigned char rootbuf[ROOT_CAP];

static int pos, len;
static int err_code, err_pos;
static int root_type, root_len;
static double root_number;
static int nodes, depth_max, numbers, strings, string_bytes;

static const unsigned char* src;

static int fail(int code, int at) {
  err_code = code;
  err_pos = at;
  return 0;
}

static void skip_ws(void) {
  while (pos < len) {
    unsigned char c = src[pos];
    if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
    pos++;
  }
}

static double pow10i(int e) {
  double r = 1.0;
  while (e > 0) {
    r *= 10.0;
    e--;
  }
  return r;
}

static int parse_value(int depth);
static int parse_string(int is_key, int depth);

static int hex4(int at, int* out) {
  int v = 0;
  for (int i = 0; i < 4; i++) {
    if (pos >= len) return fail(6, at);
    unsigned char c = src[pos++];
    int d;
    if (c >= '0' && c <= '9') d = c - '0';
    else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
    else return fail(6, at);
    v = (v << 4) | d;
  }
  *out = v;
  return 1;
}

static int store_byte(int store, int outlen, unsigned char b) {
  if (store) {
    if (outlen >= ROOT_CAP) return 0;
    rootbuf[outlen] = b;
  }
  return 1;
}

static int emit_cp(int store, int* outlen, int cp) {
  if (cp < 0x80) {
    if (!store_byte(store, *outlen, (unsigned char)cp)) return 0;
    *outlen += 1;
  } else if (cp < 0x800) {
    if (!store_byte(store, *outlen, (unsigned char)(0xC0 | (cp >> 6)))) return 0;
    if (!store_byte(store, *outlen + 1, (unsigned char)(0x80 | (cp & 0x3F)))) return 0;
    *outlen += 2;
  } else if (cp < 0x10000) {
    if (!store_byte(store, *outlen, (unsigned char)(0xE0 | (cp >> 12)))) return 0;
    if (!store_byte(store, *outlen + 1, (unsigned char)(0x80 | ((cp >> 6) & 0x3F)))) return 0;
    if (!store_byte(store, *outlen + 2, (unsigned char)(0x80 | (cp & 0x3F)))) return 0;
    *outlen += 3;
  } else {
    if (!store_byte(store, *outlen, (unsigned char)(0xF0 | (cp >> 18)))) return 0;
    if (!store_byte(store, *outlen + 1, (unsigned char)(0x80 | ((cp >> 12) & 0x3F)))) return 0;
    if (!store_byte(store, *outlen + 2, (unsigned char)(0x80 | ((cp >> 6) & 0x3F)))) return 0;
    if (!store_byte(store, *outlen + 3, (unsigned char)(0x80 | (cp & 0x3F)))) return 0;
    *outlen += 4;
  }
  return 1;
}

static int parse_string(int is_key, int depth) {
  int start = pos;
  pos++;
  int outlen = 0;
  int store = !is_key && depth == 1;

  for (;;) {
    if (pos >= len) return fail(2, len);
    unsigned char c = src[pos];
    if (c == '"') {
      pos++;
      if (store) root_len = outlen;
      strings++;
      string_bytes += outlen;
      return 1;
    }
    if (c < 0x20) return fail(6, pos);
    if (c == '\\') {
      int esc = pos;
      pos++;
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
        if (!hex4(esc, &hi)) return 0;
        if (hi >= 0xD800 && hi <= 0xDBFF) {
          if (pos + 1 >= len || src[pos] != '\\' || src[pos + 1] != 'u') return fail(6, esc);
          pos += 2;
          int lo;
          if (!hex4(esc, &lo)) return 0;
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
      if (!emit_cp(store, &outlen, cp)) return fail(8, start);
    } else {
      if (!store_byte(store, outlen, c)) return fail(8, start);
      outlen++;
      pos++;
    }
  }
}

static int parse_number(int depth, int start) {
  int neg = 0;
  if (src[pos] == '-') {
    neg = 1;
    pos++;
    if (pos >= len) return fail(2, len);
  }
  if (pos >= len) return fail(2, len);

  double value = 0.0;
  unsigned char c = src[pos];
  if (c == '0') {
    pos++;
    if (pos < len && src[pos] >= '0' && src[pos] <= '9') return fail(5, pos);
  } else if (c >= '1' && c <= '9') {
    while (pos < len && src[pos] >= '0' && src[pos] <= '9') {
      value = value * 10.0 + (double)(src[pos] - '0');
      pos++;
    }
  } else {
    return fail(5, pos);
  }

  if (pos < len && src[pos] == '.') {
    pos++;
    if (pos >= len || src[pos] < '0' || src[pos] > '9') return fail(5, pos > len ? len : pos);
    double scale = 0.1;
    while (pos < len && src[pos] >= '0' && src[pos] <= '9') {
      value += (double)(src[pos] - '0') * scale;
      scale *= 0.1;
      pos++;
    }
  }

  if (pos < len && (src[pos] == 'e' || src[pos] == 'E')) {
    pos++;
    int eneg = 0;
    if (pos < len && (src[pos] == '+' || src[pos] == '-')) {
      eneg = src[pos] == '-';
      pos++;
    }
    if (pos >= len || src[pos] < '0' || src[pos] > '9') return fail(5, pos > len ? len : pos);
    int exp = 0;
    while (pos < len && src[pos] >= '0' && src[pos] <= '9') {
      if (exp < 10000) exp = exp * 10 + (src[pos] - '0');
      pos++;
    }
    double p = pow10i(exp);
    if (eneg) value /= p;
    else value *= p;
  }

  if (neg) value = -value;
  numbers++;
  if (depth == 1) {
    root_type = 3;
    root_number = value;
  }
  (void)start;
  return 1;
}

static int parse_array(int depth) {
  pos++;
  skip_ws();
  if (pos < len && src[pos] == ']') {
    pos++;
    if (depth == 1) root_len = 0;
    return 1;
  }
  int count = 0;
  for (;;) {
    count++;
    if (!parse_value(depth + 1)) return 0;
    skip_ws();
    if (pos >= len) return fail(2, len);
    if (src[pos] == ',') {
      pos++;
      skip_ws();
      if (pos >= len) return fail(2, len);
      if (src[pos] == ']') return fail(1, pos);
      continue;
    }
    if (src[pos] == ']') {
      pos++;
      break;
    }
    return fail(1, pos);
  }
  if (depth == 1) root_len = count;
  return 1;
}

static int parse_object(int depth) {
  pos++;
  skip_ws();
  if (pos < len && src[pos] == '}') {
    pos++;
    if (depth == 1) root_len = 0;
    return 1;
  }
  int count = 0;
  for (;;) {
    skip_ws();
    if (pos >= len) return fail(2, len);
    if (src[pos] != '"') return fail(1, pos);
    if (!parse_string(1, depth)) return 0;
    skip_ws();
    if (pos >= len) return fail(2, len);
    if (src[pos] != ':') return fail(1, pos);
    pos++;
    count++;
    if (!parse_value(depth + 1)) return 0;
    skip_ws();
    if (pos >= len) return fail(2, len);
    if (src[pos] == ',') {
      pos++;
      skip_ws();
      if (pos >= len) return fail(2, len);
      if (src[pos] == '}') return fail(1, pos);
      continue;
    }
    if (src[pos] == '}') {
      pos++;
      break;
    }
    return fail(1, pos);
  }
  if (depth == 1) root_len = count;
  return 1;
}

static int parse_value(int depth) {
  if (depth > MAX_DEPTH) return fail(4, pos);
  if (depth > depth_max) depth_max = depth;
  skip_ws();
  if (pos >= len) return fail(2, len);

  unsigned char c = src[pos];
  int start = pos;
  nodes++;

  if (c == '{') {
    if (depth == 1) root_type = 6;
    return parse_object(depth);
  }
  if (c == '[') {
    if (depth == 1) root_type = 5;
    return parse_array(depth);
  }
  if (c == '"') {
    if (depth == 1) root_type = 4;
    return parse_string(0, depth);
  }
  if (c == 't') {
    if (pos + 4 <= len && src[pos + 1] == 'r' && src[pos + 2] == 'u' && src[pos + 3] == 'e') {
      pos += 4;
      if (depth == 1) root_type = 2;
      return 1;
    }
    return fail(1, start);
  }
  if (c == 'f') {
    if (pos + 5 <= len && src[pos + 1] == 'a' && src[pos + 2] == 'l' && src[pos + 3] == 's' && src[pos + 4] == 'e') {
      pos += 5;
      if (depth == 1) root_type = 1;
      return 1;
    }
    return fail(1, start);
  }
  if (c == 'n') {
    if (pos + 4 <= len && src[pos + 1] == 'u' && src[pos + 2] == 'l' && src[pos + 3] == 'l') {
      pos += 4;
      if (depth == 1) root_type = 0;
      return 1;
    }
    return fail(1, start);
  }
  if (c == '-' || (c >= '0' && c <= '9')) {
    return parse_number(depth, start);
  }
  return fail(1, pos);
}

int json_input_ptr(void) { return (int)(unsigned long)input; }

int json_parse(int n) {
  err_code = 0;
  err_pos = 0;
  root_type = 0;
  root_len = 0;
  root_number = 0.0;
  nodes = 0;
  depth_max = 0;
  numbers = 0;
  strings = 0;
  string_bytes = 0;

  if (n < 0 || n > CAP) {
    err_code = 8;
    err_pos = 0;
    return 8;
  }

  pos = 0;
  len = n;
  src = input;

  if (!parse_value(1)) return err_code;
  skip_ws();
  if (pos != len) {
    fail(3, pos);
    return err_code;
  }
  return 0;
}

int json_error_pos(void) { return err_pos; }
int json_error_code(void) { return err_code; }
int json_root_type(void) { return root_type; }
double json_root_number(void) { return root_number; }
int json_root_len(void) { return root_len; }
int json_root_ptr(void) { return (int)(unsigned long)rootbuf; }
int json_nodes(void) { return nodes; }
int json_depth(void) { return depth_max; }
int json_numbers(void) { return numbers; }
int json_strings(void) { return strings; }
int json_string_bytes(void) { return string_bytes; }
