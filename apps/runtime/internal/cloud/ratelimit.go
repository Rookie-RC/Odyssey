package cloud

import (
	"sync"
	"time"
)

// limiter is a fixed-window counter per key (an IP, an email, a user id).
// Good enough to blunt password guessing and runaway clients on a single
// server; it is in-memory, so a restart resets it.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	now    func() time.Time
	hits   map[string]*window
}

type window struct {
	start time.Time
	n     int
}

func newLimiter(max int, per time.Duration) *limiter {
	return &limiter{max: max, window: per, now: time.Now, hits: map[string]*window{}}
}

// allow records one hit for key and reports whether it is within the limit,
// and if not, how long until the window resets.
func (l *limiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.hits) > 10000 { // drop expired windows now and then
		for k, w := range l.hits {
			if now.Sub(w.start) >= l.window {
				delete(l.hits, k)
			}
		}
	}
	w := l.hits[key]
	if w == nil || now.Sub(w.start) >= l.window {
		w = &window{start: now}
		l.hits[key] = w
	}
	if w.n >= l.max {
		return false, w.start.Add(l.window).Sub(now)
	}
	w.n++
	return true, 0
}

// reset forgets key (e.g. after a successful login).
func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}
