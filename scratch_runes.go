package main

import (
	"fmt"
)

func main() {
	words := []string{"hoà", "hòa", "thuỷ", "thủy", "hoè", "hòe", "huý", "húy"}
	for _, w := range words {
		fmt.Printf("%s: ", w)
		for _, r := range w {
			fmt.Printf("%U (%q) ", r, string(r))
		}
		fmt.Println()
	}
}
