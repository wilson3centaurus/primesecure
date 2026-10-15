package com.robokorda.primesecure

import java.util.Locale

/** Display/caret handling only. This never stores, logs or grants authority to a key. */
internal object EnrollmentKey {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val DASHES = "-\u00ad\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe58\ufe63\uff0d"

    enum class Problem { EMPTY, INCOMPLETE, TOO_LONG, INVALID_CHARACTER }

    data class Edit(val text: String, val selectionStart: Int, val selectionEnd: Int)

    /** The edit Android has just applied, before automatic formatting. */
    data class Change(
        val previous: String,
        val start: Int,
        val removed: Int,
        val inserted: Int,
        val previousSelectionStart: Int,
        val previousSelectionEnd: Int,
    )

    private fun separator(char: Char) = char.isWhitespace() || Character.isSpaceChar(char) || char in DASHES

    /** Matches the Edge function's case/ambiguous-letter canonicalization. */
    fun compact(value: String): String = value.uppercase(Locale.ROOT)
        .filterNot(::separator).replace('I', '1').replace('L', '1').replace('O', '0')

    fun problem(value: String): Problem? {
        val plain = compact(value)
        return when {
            plain.any { it !in ALPHABET } -> Problem.INVALID_CHARACTER
            plain.isEmpty() -> Problem.EMPTY
            plain.length < 8 -> Problem.INCOMPLETE
            plain.length > 8 -> Problem.TOO_LONG
            else -> null
        }
    }

    /** Only complete Crockford keys can reach enrollment or provisioning. */
    fun canonical(value: String): String? {
        if (problem(value) != null) return null
        val plain = compact(value)
        return plain.take(4) + "-" + plain.drop(4)
    }

    /**
     * Keep invalid/extra characters visible so validation can explain them.
     * Deleting just the generated dash deletes the adjacent key character in
     * the requested direction instead of trapping Backspace/Delete on it.
     */
    fun format(
        value: String,
        selectionStart: Int = value.length,
        selectionEnd: Int = selectionStart,
        change: Change? = null,
    ): Edit {
        var raw = value
        var start = selectionStart.coerceIn(0, raw.length)
        var end = selectionEnd.coerceIn(0, raw.length)
        if (change != null && change.removed == 1 && change.inserted == 0 &&
            change.previousSelectionStart == change.previousSelectionEnd &&
            change.start in change.previous.indices && change.previous[change.start] in DASHES &&
            raw == change.previous.removeRange(change.start, change.start + 1)
        ) {
            val backwards = change.previousSelectionStart == change.start + 1 && change.start > 0
            val removeAt = if (backwards) raw.offsetByCodePoints(change.start, -1)
                else if (change.previousSelectionStart == change.start && change.start < raw.length) change.start else -1
            if (removeAt >= 0) {
                val removeEnd = if (backwards) change.start else raw.offsetByCodePoints(removeAt, 1)
                raw = raw.removeRange(removeAt, removeEnd)
                if (start > removeAt) start -= minOf(start - removeAt, removeEnd - removeAt)
                if (end > removeAt) end -= minOf(end - removeAt, removeEnd - removeAt)
            }
        }
        val plain = compact(raw)
        val groupEnd = plain.offsetByCodePoints(0, minOf(4, plain.codePointCount(0, plain.length)))
        val hasDash = plain.length > groupEnd
        val display = if (hasDash) plain.take(groupEnd) + "-" + plain.drop(groupEnd) else plain
        fun caret(position: Int): Int {
            val prefix = raw.take(position)
            val letters = compact(prefix).length
            val afterSeparator = prefix.lastOrNull()?.let(::separator) == true
            return (letters + if (hasDash && (letters > groupEnd || letters == groupEnd && afterSeparator)) 1 else 0)
                .coerceIn(0, display.length)
        }
        return Edit(display, caret(start), caret(end))
    }
}
