/*
 * The one hot loop of the Maia-3 forward pass (net.js), as wasm SIMD.
 * Part of Chessboard, GPL-3.0-or-later. Built by scripts/gen-maia3-wasm.mjs:
 *
 *   clang --target=wasm32 -O3 -msimd128 -nostdlib -Wl,--no-entry ...
 *
 * gemm:  C[M×N] = alpha · A[M×K] · B[K×N] (+ C if acc) (+ bias[N])
 * Row-major with leading dimensions lda/ldb/ldc (in floats). Pointers are
 * byte offsets into the module's own memory, which net.js lays out.
 *
 * The block is 4 rows × 16 columns: 16 accumulators of 4 lanes; per k, four
 * scalars of A are broadcast against four vectors of B. Columns that do not
 * fill a vector, and rows past the last block of four, take the scalar path.
 */
#include <wasm_simd128.h>

#define EXPORT(name) __attribute__((export_name(name)))

static inline void store(float *c, v128_t v, v128_t alpha, int acc, const float *bias) {
  v = wasm_f32x4_mul(v, alpha);
  if (acc) v = wasm_f32x4_add(v, wasm_v128_load(c));
  if (bias) v = wasm_f32x4_add(v, wasm_v128_load(bias));
  wasm_v128_store(c, v);
}

EXPORT("gemm")
void gemm(int M, int N, int K, float alpha,
          const float *A, int lda, const float *B, int ldb,
          float *C, int ldc, const float *bias, int acc) {
  const v128_t al = wasm_f32x4_splat(alpha);
  const int N16 = N & ~15, M4 = M & ~3;
  int i = 0;
  for (; i < M4; i += 4) {
    const float *a0 = A + i * lda, *a1 = a0 + lda, *a2 = a1 + lda, *a3 = a2 + lda;
    for (int j = 0; j < N16; j += 16) {
      v128_t c00 = wasm_f32x4_splat(0), c01 = c00, c02 = c00, c03 = c00;
      v128_t c10 = c00, c11 = c00, c12 = c00, c13 = c00;
      v128_t c20 = c00, c21 = c00, c22 = c00, c23 = c00;
      v128_t c30 = c00, c31 = c00, c32 = c00, c33 = c00;
      const float *b = B + j;
      for (int k = 0; k < K; k++, b += ldb) {
        const v128_t b0 = wasm_v128_load(b), b1 = wasm_v128_load(b + 4);
        const v128_t b2 = wasm_v128_load(b + 8), b3 = wasm_v128_load(b + 12);
        v128_t x = wasm_f32x4_splat(a0[k]);
        c00 = wasm_f32x4_add(c00, wasm_f32x4_mul(x, b0)); c01 = wasm_f32x4_add(c01, wasm_f32x4_mul(x, b1));
        c02 = wasm_f32x4_add(c02, wasm_f32x4_mul(x, b2)); c03 = wasm_f32x4_add(c03, wasm_f32x4_mul(x, b3));
        x = wasm_f32x4_splat(a1[k]);
        c10 = wasm_f32x4_add(c10, wasm_f32x4_mul(x, b0)); c11 = wasm_f32x4_add(c11, wasm_f32x4_mul(x, b1));
        c12 = wasm_f32x4_add(c12, wasm_f32x4_mul(x, b2)); c13 = wasm_f32x4_add(c13, wasm_f32x4_mul(x, b3));
        x = wasm_f32x4_splat(a2[k]);
        c20 = wasm_f32x4_add(c20, wasm_f32x4_mul(x, b0)); c21 = wasm_f32x4_add(c21, wasm_f32x4_mul(x, b1));
        c22 = wasm_f32x4_add(c22, wasm_f32x4_mul(x, b2)); c23 = wasm_f32x4_add(c23, wasm_f32x4_mul(x, b3));
        x = wasm_f32x4_splat(a3[k]);
        c30 = wasm_f32x4_add(c30, wasm_f32x4_mul(x, b0)); c31 = wasm_f32x4_add(c31, wasm_f32x4_mul(x, b1));
        c32 = wasm_f32x4_add(c32, wasm_f32x4_mul(x, b2)); c33 = wasm_f32x4_add(c33, wasm_f32x4_mul(x, b3));
      }
      const float *bj = bias ? bias + j : 0;
      float *c = C + i * ldc + j;
      store(c, c00, al, acc, bj); store(c + 4, c01, al, acc, bj ? bj + 4 : 0);
      store(c + 8, c02, al, acc, bj ? bj + 8 : 0); store(c + 12, c03, al, acc, bj ? bj + 12 : 0);
      c += ldc;
      store(c, c10, al, acc, bj); store(c + 4, c11, al, acc, bj ? bj + 4 : 0);
      store(c + 8, c12, al, acc, bj ? bj + 8 : 0); store(c + 12, c13, al, acc, bj ? bj + 12 : 0);
      c += ldc;
      store(c, c20, al, acc, bj); store(c + 4, c21, al, acc, bj ? bj + 4 : 0);
      store(c + 8, c22, al, acc, bj ? bj + 8 : 0); store(c + 12, c23, al, acc, bj ? bj + 12 : 0);
      c += ldc;
      store(c, c30, al, acc, bj); store(c + 4, c31, al, acc, bj ? bj + 4 : 0);
      store(c + 8, c32, al, acc, bj ? bj + 8 : 0); store(c + 12, c33, al, acc, bj ? bj + 12 : 0);
    }
  }
  // rows past the last block of four, all columns; then the column tail of the blocked rows
  for (int r = 0; r < M; r++) {
    const int j0 = r < M4 ? N16 : 0;
    const float *a = A + r * lda;
    for (int j = j0; j + 4 <= N; j += 4) {
      v128_t s = wasm_f32x4_splat(0);
      const float *b = B + j;
      for (int k = 0; k < K; k++, b += ldb) s = wasm_f32x4_add(s, wasm_f32x4_mul(wasm_f32x4_splat(a[k]), wasm_v128_load(b)));
      store(C + r * ldc + j, s, al, acc, bias ? bias + j : 0);
    }
    for (int j = j0 + ((N - j0) & ~3); j < N; j++) {
      float s = 0;
      for (int k = 0; k < K; k++) s += a[k] * B[k * ldb + j];
      float *c = C + r * ldc + j;
      *c = alpha * s + (acc ? *c : 0) + (bias ? bias[j] : 0);
    }
  }
}
