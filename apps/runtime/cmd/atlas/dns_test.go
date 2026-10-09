package main

import (
	"reflect"
	"testing"
)

func TestParseDNSServers(t *testing.T) {
	got := parseDNSServers(" 1.1.1.1, [2001:db8::1],, 9.9.9.9:5353, fe80::1 ")
	want := []string{"1.1.1.1:53", "[2001:db8::1]:53", "9.9.9.9:5353", "[fe80::1]:53"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if parseDNSServers("") != nil {
		t.Fatal("empty list should configure nothing")
	}
}
