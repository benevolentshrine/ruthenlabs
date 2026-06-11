package main

import (
	"fmt"
	"os"
)

func main() {
	// Print a greeting
	fmt.Println("Hello, World!")

	// Check if a file exists
	if _, err := os.Stat("README.md"); os.IsNotExist(err) {
		fmt.Println("README.md does not exist.")
	} else {
		fmt.Println("README.md exists.")
	}

	// Print a simple message
	fmt.Println("This is a simple Go program.")
}
