package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

type googleBooksResponse struct {
	Items []struct {
		VolumeInfo struct {
			Title         string   `json:"title"`
			Authors       []string `json:"authors"`
			Publisher     string   `json:"publisher"`
			PublishedDate string   `json:"publishedDate"`
			Description   string   `json:"description"`
			Categories    []string `json:"categories"`
			ImageLinks    struct {
				Thumbnail      string `json:"thumbnail"`
				SmallThumbnail string `json:"smallThumbnail"`
			} `json:"imageLinks"`
			Language string `json:"language"`
		} `json:"volumeInfo"`
	} `json:"items"`
}

type openLibraryResponse struct {
	Docs []struct {
		Title      string   `json:"title"`
		AuthorName []string `json:"author_name"`
		Publisher  []string `json:"publisher"`
		Language   []string `json:"language"`
		CoverI     int      `json:"cover_i"`
		Subject    []string `json:"subject"`
	} `json:"docs"`
}

func cleanQueryForFallback(query string) string {
	if idx := strings.Index(query, "-"); idx != -1 {
		part := strings.TrimSpace(query[:idx])
		if part != "" {
			query = part
		}
	}
	re := regexp.MustCompile(`(?i)\s*(?:tập|vol(?:ume)?|quyển|chương|chuong)\b.*`)
	query = re.ReplaceAllString(query, "")
	return strings.TrimSpace(query)
}

func (s *Service) SearchMetadataOnline(query string) ([]BookMetadata, error) {
	if query == "" {
		return nil, errors.New("truy vấn tìm kiếm rỗng")
	}

	results, err := s.searchGoogleBooks(query)
	if err == nil && len(results) > 0 {
		return results, nil
	}

	cleanQuery := cleanQueryForFallback(query)
	var olResults []BookMetadata
	var olErr error
	if cleanQuery != "" {
		olResults, olErr = s.searchOpenLibrary(cleanQuery)
	}

	if (olErr != nil || len(olResults) == 0) && cleanQuery != query {
		var olErr2 error
		olResults, olErr2 = s.searchOpenLibrary(query)
		if olErr2 != nil {
			olErr = olErr2
		}
	}

	if olErr == nil && len(olResults) > 0 {
		return olResults, nil
	}

	if err != nil {
		return nil, fmt.Errorf("%w (Open Library fallback error: %v)", err, olErr)
	}

	if olErr != nil {
		return nil, olErr
	}

	return nil, nil
}

func (s *Service) searchGoogleBooks(query string) ([]BookMetadata, error) {
	apiURL := "https://www.googleapis.com/books/v1/volumes?q=" + url.QueryEscape(query)
	resp, err := http.Get(apiURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google books API returned status: %d", resp.StatusCode)
	}

	var data googleBooksResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	var results []BookMetadata
	for _, item := range data.Items {
		info := item.VolumeInfo
		author := strings.Join(info.Authors, ", ")

		cover := info.ImageLinks.Thumbnail
		if cover == "" {
			cover = info.ImageLinks.SmallThumbnail
		}

		if strings.HasPrefix(cover, "http://") {
			cover = "https://" + strings.TrimPrefix(cover, "http://")
		}

		subject := strings.Join(info.Categories, ", ")

		results = append(results, BookMetadata{
			Title:       info.Title,
			Creator:     author,
			Language:    info.Language,
			Publisher:   info.Publisher,
			Description: info.Description,
			Subject:     subject,
			CoverImage:  cover,
		})
	}

	return results, nil
}

func (s *Service) searchOpenLibrary(query string) ([]BookMetadata, error) {
	apiURL := "https://openlibrary.org/search.json?q=" + url.QueryEscape(query) + "&limit=10"
	resp, err := http.Get(apiURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open library API returned status: %d", resp.StatusCode)
	}

	var data openLibraryResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	var results []BookMetadata
	for _, doc := range data.Docs {
		author := strings.Join(doc.AuthorName, ", ")
		publisher := ""
		if len(doc.Publisher) > 0 {
			publisher = doc.Publisher[0]
		}
		language := ""
		if len(doc.Language) > 0 {
			language = doc.Language[0]
		}

		cover := ""
		if doc.CoverI > 0 {
			cover = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", doc.CoverI)
		}

		limitSubjects := doc.Subject
		if len(limitSubjects) > 5 {
			limitSubjects = limitSubjects[:5]
		}
		subject := strings.Join(limitSubjects, ", ")

		results = append(results, BookMetadata{
			Title:       doc.Title,
			Creator:     author,
			Language:    language,
			Publisher:   publisher,
			Description: fmt.Sprintf("Sách tìm thấy qua Open Library. Thể loại chính: %s", subject),
			Subject:     subject,
			CoverImage:  cover,
		})
	}

	return results, nil
}
